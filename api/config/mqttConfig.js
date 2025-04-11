const mqtt = require('mqtt');

const options = {
  clientId: "api_client_" + Math.random().toString(16).substr(2, 8),
  username: "Compteur",
  password: "Compteur",
  rejectUnauthorized: false
};

const client = mqtt.connect('mqtts://compteur.cielnewton.fr:8883', options);

client.on('connect', () => {
  console.log("✅ API connected to MQTT broker");
});

client.on('error', (err) => {
  console.error("❌ MQTT error:", err);
});

// ✅ Export only the client
module.exports = client;
