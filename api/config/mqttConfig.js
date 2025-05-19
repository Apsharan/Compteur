const fs = require('fs');
const mqtt = require('mqtt');

const options = {
    host: 'mosquitto',
    port: 8883,
    protocol: 'mqtts',
    username: 'Compteur',
    password: 'Compteur',
    rejectUnauthorized: false,
    ca: fs.readFileSync('/mosquitto/certs/ca.pem'),
    cert: fs.readFileSync('/mosquitto/certs/client.crt'),
    key: fs.readFileSync('/mosquitto/certs/client.key')
};

module.exports = mqtt.connect(options);
