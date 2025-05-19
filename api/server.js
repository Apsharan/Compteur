const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const WebSocket = require('ws');
const mqttClient = require('./config/mqttConfig');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const influxConfig = require('./config/influxConfig');
const appConfig = require('./config/appConfig');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const port = 3000;

// 🔐 Security Headers
app.use(helmet());

// 🌐 Middleware
app.use(bodyParser.json());
app.use(express.json());
app.set('trust proxy', true);

// 🚫 Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Too many requests, please try again later." }
});
app.use(limiter);

// 🔑 API Key Protection
function authMiddleware(req, res, next) {
    const key = req.headers['x-api-key'];
    if (key !== appConfig.apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// 📈 InfluxDB
const influx = new InfluxDB({ url: influxConfig.url, token: influxConfig.token });
const writeApi = influx.getWriteApi(influxConfig.org, influxConfig.bucket, 'ns');

// 📡 MQTT
const mqttTopic = 'water-meter/data';
let currentMode = "present";

// 🔌 HTTP + WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.broadcast = function (data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
};

// ✅ MQTT Connect
mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT Broker');
    mqttClient.subscribe([mqttTopic, 'water-meter/mode'], err => {
        if (err) console.error("❌ MQTT Subscribe Failed:", err);
        else console.log("✅ Subscribed to topics");
    });
});

mqttClient.on('message', async (topic, message) => {
    try {
        const data = JSON.parse(message.toString().trim());

        if (topic === 'water-meter/mode' && data.mode) {
            currentMode = data.mode;
            return;
        }

        if (data.water_used === undefined || data.electrovalve === undefined) {
            console.error("❌ Missing data fields");
            return;
        }

        const point = new Point('water_usage')
            .floatField('water_used', parseFloat(data.water_used))
            .booleanField('electrovalve', Boolean(data.electrovalve))
            .intField('nonce', Date.now())
            .timestamp(new Date());

        await writeApi.writePoint(point);
        await writeApi.flush();

        wss.broadcast({
            type: "live_update",
            data
        });

        console.log("✅ Written to InfluxDB and broadcasted");
    } catch (err) {
        console.error("❌ MQTT Message Error:", err.message);
    }
});

// 📊 GET Latest Data
app.get('/api/data', authMiddleware, async (req, res) => {
    const queryApi = influx.getQueryApi(influxConfig.org);
    const fluxQuery = `
        from(bucket: "${influxConfig.bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "water_usage")
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> sort(columns:["_time"], desc: true)
        |> limit(n:1)
    `;

    let result = null;
    await new Promise((resolve, reject) => {
        queryApi.queryRows(fluxQuery, {
            next(row, tableMeta) {
                const obj = tableMeta.toObject(row);

                // 1) Convert Influx UTC -> JS date object
                const utcDate = new Date(obj._time);

                // 2) Format local time explicitly. For example, Europe/Paris
                const localTime = utcDate.toLocaleString('fr-FR', {
                  timeZone: 'Europe/Paris',
                  hour12: false,         // use 24-hour format
                  // you can also specify more options:
                  // weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
                  // hour: '2-digit', minute: '2-digit', second: '2-digit'
                });

                // Now build your response object
                result = {
                    timestamp_utc: obj._time, // Keep for reference if you want
                    timestamp_local: localTime,
                    water_used: obj.water_used,
                    electrovalve: obj.electrovalve
                };
            },
            error: reject,
            complete: resolve
        });
    });

    if (!result) {
        return res.status(404).json({ error: "No data found" });
    }

    res.json(result);
});

// 💧 GET Debit Calculation
app.get('/api/debit', authMiddleware, async (req, res) => {
    const queryApi = influx.getQueryApi(influxConfig.org);
    const fluxQuery = `
        from(bucket: "${influxConfig.bucket}")
        |> range(start: -1m)
        |> filter(fn: (r) => r._measurement == "water_usage" and r._field == "water_used")
        |> aggregateWindow(every: 1s, fn: max, createEmpty: false)
        |> difference()
        |> yield(name: "flow_per_second")
    `;

    let values = [];

    await new Promise((resolve, reject) => {
        queryApi.queryRows(fluxQuery, {
            next(row, tableMeta) {
                const obj = tableMeta.toObject(row);
                if (typeof obj._value === 'number') values.push(obj._value);
            },
            error: reject,
            complete: resolve
        });
    });

    if (values.length === 0) {
        return res.status(404).json({ error: "No data found" });
    }

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const conversionRate = 0.0025; // pulses to liters (adjust this)
    const response = {
        average_flow_rate: parseFloat(avg.toFixed(2)),
        liters_per_minute: parseFloat((avg * conversionRate).toFixed(3)),
        unit: "pulses/min",
        duration: "last 1 minute"
    };

    wss.broadcast({
        type: "debit_update",
        data: response
    });

    res.status(200).json(response);
});

// 🚰 Valve Control
app.post('/api/valve', authMiddleware, (req, res) => {
    const command = req.body.command;
    if (!['on', 'off'].includes(command)) {
        return res.status(400).json({ error: 'Invalid command' });
    }

    const payload = JSON.stringify({ electrovalve: command === 'on' });
    mqttClient.publish('water-meter/valve', payload, err => {
        if (err) return res.status(500).json({ error: 'MQTT publish failed' });

        wss.broadcast({
            type: "valve_command",
            electrovalve: command === 'on'
        });

        res.status(200).json({ success: true, electrovalve: command === 'on' });
    });
});

// 🧠 Mode Change
app.post('/api/mode', authMiddleware, (req, res) => {
    const { mode } = req.body;
    if (!["present", "absent"].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode. Use "present" or "absent"' });
    }

    const payload = JSON.stringify({ mode });
    mqttClient.publish('water-meter/mode', payload, err => {
        if (err) return res.status(500).json({ error: 'MQTT publish failed' });

        wss.broadcast({
            type: "mode_change",
            mode
        });

        res.status(200).json({ success: true, mode });
    });
});

// 🚀 Start Server
server.listen(port, () => {
    console.log(`🚀 API + WebSocket server listening on port ${port}`);
});
