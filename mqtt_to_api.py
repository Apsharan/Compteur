import paho.mqtt.client as mqtt
import requests
import json

# MQTT Configuration
MQTT_BROKER = "compteur.cielnewton.fr"
MQTT_PORT = 8883
MQTT_TOPIC = "water-meter/data"
MQTT_USER = "Compteur"
MQTT_PASSWORD = "Compteur"
CA_CERT = "/etc/mosquitto/certs/ca.crt"

# API Configuration
API_URL = "http://localhost:3000/data"

# MQTT Callback
def on_message(client, userdata, message):
    payload = message.payload.decode()
    print(f"Received message: {payload}")

    try:
        data = json.loads(payload)
        response = requests.post(API_URL, json=data)
        print(f"Data sent to API, Response: {response.status_code}")
    except Exception as e:
        print(f"Error sending data: {e}")

# Set up MQTT client
client = mqtt.Client()
client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
client.tls_set(CA_CERT)
client.on_message = on_message
client.connect(MQTT_BROKER, MQTT_PORT)
client.subscribe(MQTT_TOPIC)
client.loop_forever()
