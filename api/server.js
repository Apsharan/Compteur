const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const WebSocket = require('ws');
const mqttClient = require('./config/mqttConfig');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const influxConfig = require('./config/influxConfig');
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

// 🚫 Rate Limiting (100 requests / 15 minutes per IP)
//const limiter = rateLimit({
//    windowMs: 15 * 60 * 1000,
//    max: 100,
//    message: { error: "Too many requests, please try again later." }
//});
//app.use(limiter);

// 🔑 API Key Protection for Valve Control
const VALVE_API_KEY = 'supersecrettoken123'; // 🔐 change this in production!

function authMiddleware(req, res, next) {
    console.log("🔐 Checking API key middleware...");
    const key = req.headers['x-api-key'];
    console.log("🔑 Received key:", key);
    if (key !== VALVE_API_KEY) {
        console.log("❌ Unauthorized attempt with key:", key);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    console.log("✅ Authorized");
    next();
}

// 📈 InfluxDB Setup
const influx = new InfluxDB({ url: influxConfig.url, token: influxConfig.token });
const writeApi = influx.getWriteApi(influxConfig.org, influxConfig.bucket, 'ns');

// 📡 MQTT Topic
const mqttTopic = 'water-meter/data';

// 🔌 HTTP + WebSocket Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.broadcast = function (data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
};

// 📥 MQTT Data Ingestion
mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT Broker');
    mqttClient.subscribe(mqttTopic, (err) => {
        if (err) console.error("❌ MQTT Subscribe Failed:", err);
        else console.log(`✅ Subscribed to ${mqttTopic}`);
    });
});

mqttClient.on('message', async (topic, message) => {
    try {
        const msg = message.toString().trim();
        const data = JSON.parse(msg);

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

        console.log("✅ Written to InfluxDB and broadcasted via WebSocket");
    } catch (err) {
        console.error("❌ MQTT Message Error:", err.message);
    }
});

// 📊 GET latest data from InfluxDB
app.get('/api/data', async (req, res) => {
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
                result = {
                    timestamp: obj._time,
                    water_flow: obj.water_flow,
                    water_used: obj.water_used,
                    electrovalve: obj.electrovalve
                };
            },
            error: reject,
            complete: resolve
        });
    });

    if (!result) return res.status(404).json({ error: "No data found" });
    res.json(result);
});

// 🔧 Secure Debit Calculation Endpoint (with middleware)
app.get('/api/debit', authMiddleware, async (req, res) => {
    const queryApi = influx.getQueryApi(influxConfig.org);

    const fluxQuery = `
        from(bucket: "${influxConfig.bucket}")
            |> range(start: -1m)
            |> filter(fn: (r) => r._measurement == "water_usage" and r._field == "water_used")
            |> aggregateWindow(every: 10s, fn: last, createEmpty: false)
            |> difference()
            |> filter(fn: (r) => r._value > 0)
            |> yield(name: "water_flow")
    `;

    let flows = [];

    await new Promise((resolve, reject) => {
        queryApi.queryRows(fluxQuery, {
            next(row, tableMeta) {
                const obj = tableMeta.toObject(row);
                flows.push(obj._value);
            },
            error: (err) => {
                console.error("❌ Influx query error:", err);
                reject(err);
            },
            complete: resolve
        });
    });

    if (flows.length === 0) {
        const response = {
            average_flow_rate: 0,
            liters_per_minute: 0,
            unit: "pulses/min",
            duration: "last 1 minute"
        };

        wss.broadcast({
            type: "debit_update",
            data: response
        });

        return res.status(200).json(response);
    }

    const averageFlow = flows.reduce((acc, val) => acc + val, 0) / flows.length;
    const litersPerMinute = averageFlow / 450; // ⚠️ Adjust if your sensor uses different calibration

    const response = {
        average_flow_rate: parseFloat(averageFlow.toFixed(2)),
        liters_per_minute: parseFloat(litersPerMinute.toFixed(3)),
        unit: "pulses/min",
        duration: "last 1 minute"
    };

    wss.broadcast({
        type: "debit_update",
        data: response
    });

    res.status(200).json(response);
});

// 🔧 Secure Valve Control Endpoint
app.post('/api/valve', authMiddleware, (req, res) => {
    const command = req.body.command;
    if (command !== 'on' && command !== 'off') {
        return res.status(400).json({ error: 'Invalid command' });
    }

    const payload = JSON.stringify({ electrovalve: command === 'on' });
    mqttClient.publish('water-meter/valve', payload, (err) => {
        if (err) return res.status(500).json({ error: 'MQTT publish failed' });

        wss.broadcast({
            type: "valve_command",
            electrovalve: command === 'on'
        });

        res.status(200).json({ success: true, electrovalve: command === 'on' });
    });
});

// 🔧 Secure Mode Control Endpoint (with middleware)
app.post('/api/mode', authMiddleware, (req, res) => {
    const { mode } = req.body;

    if (!["present", "absent"].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode. Allowed values: present, absent' });
    }

    const payload = JSON.stringify({ mode });
    mqttClient.publish('water-meter/mode', payload, (err) => {
        if (err) {
            console.error('❌ MQTT publish failed:', err);
            return res.status(500).json({ error: 'MQTT publish failed' });
        }

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
