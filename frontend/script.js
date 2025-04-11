function setMode(mode) {
  console.log(`Setting mode to: ${mode}`);
  
  // Send the mode to the API
  fetch("https://compteur.cielnewton.fr/api/mode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "supersecrettoken123"
    },
    body: JSON.stringify({ mode: mode })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error("Erreur HTTP: " + response.status);
    }
    return response.json();
  })
  .then(data => {
    console.log(`✅ Mode ${mode} envoyé`, data);

    // Update electrovalve state based on mode
    if (mode === 'absent') {
      closeElectrovalve();  // Automatically close the electrovalve when mode is absent
    } else if (mode === 'present') {
      enableElectrovalveControl();  // Allow electrovalve control when mode is present
    }
  })
  .catch(error => {
    console.error("❌ Erreur en envoyant la commande:", error);
  });
}

// Automatically close electrovalve when in 'absent' mode
function closeElectrovalve() {
  console.log("Automatically closing the electrovalve (mode absent).");
  fetch("https://compteur.cielnewton.fr/api/valve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "supersecrettoken123"
    },
    body: JSON.stringify({ command: 'off' })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error("Erreur HTTP: " + response.status);
    }
    return response.json();
  })
  .then(data => {
    console.log("✅ Electrovalve closed:", data);
  })
  .catch(error => {
    console.error("❌ Erreur en fermant la vanne:", error);
  });
}

// Enable electrovalve control when in 'present' mode
function enableElectrovalveControl() {
  console.log("Electrovalve control enabled (mode présent).");
  // Here you can ensure that the electrovalve is open or ready for manual control if needed
  // You can also reset any states if necessary.
}

// ✅ WebSocket pour les données en temps réel
let ws = new WebSocket('wss://compteur.cielnewton.fr/mqtt/');

ws.onopen = function () {
  console.log("Connexion WebSocket établie !");
  document.getElementById("status").textContent = "✅ Connexion WebSocket réussie";
};

ws.onmessage = function (event) {
  const message = JSON.parse(event.data);
  console.log("Message reçu:", message);

  if (message.type === "live_update") {
    updateWaterData(message.type, message.data);
  }

  if (message.type === "valve_command") {
    document.getElementById("valveState").innerText = `Valve: ${message.electrovalve ? "Ouverte" : "Fermée"}`;
  }
};

ws.onerror = function (error) {
  console.error("Erreur WebSocket:", error);
  document.getElementById("status").textContent = "❌ Erreur WebSocket";
};

ws.onclose = function () {
  console.warn("WebSocket fermé. Nouvelle tentative...");
  document.getElementById("status").textContent = "🔌 Déconnecté. Reconnexion...";
  setTimeout(() => {
    ws = new WebSocket('wss://compteur.cielnewton.fr/mqtt');
  }, 5000);
};

// ✅ Fonction globale pour les boutons HTML
function sendValveCommand(state) {
  console.log(`Sending command to valve: ${state}`);
  fetch("https://compteur.cielnewton.fr/api/valve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "supersecrettoken123"
    },
    body: JSON.stringify({ command: state })
  })
  .then(response => {
    if (!response.ok) {
      throw new Error("Erreur HTTP: " + response.status);
    }
    return response.json();
  })
  .then(data => {
    console.log(`✅ Commande envoyée (${state})`, data);
  })
  .catch(error => {
    console.error("❌ Erreur en envoyant la commande:", error);
  });
}

// Function to update water data on the frontend
function updateWaterData(topic, data) {
  const waterUsedElement = document.getElementById("waterUsed");
  const electrovalveElement = document.getElementById("electrovalve");

  if (waterUsedElement) {
    waterUsedElement.textContent = `💧 Utilisé: ${data.water_used} L`;
  }

  if (electrovalveElement) {
    electrovalveElement.textContent = `🔧 Valve: ${data.electrovalve ? "Ouverte" : "Fermée"}`;
  }
}
