// ==== AUTHENTICATION ====

function customLogin() {
  const username = document.getElementById("login-user").value.trim();
  const password = document.getElementById("login-pass").value.trim();

  if (!username || !password) {
    alert("Veuillez remplir tous les champs.");
    return;
  }

  const correctUser = "admin";
  const correctPass = "water123";

  if (username === correctUser && password === correctPass) {
    document.getElementById("login-box").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    document.getElementById("graph").style.display = "none";
    document.getElementById("status").style.display = "block";
    document.getElementById("navigation").style.display = "block";
    startWebSocket(); // 👈 Start live updates only after login
  } else {
    document.getElementById("login-error").style.display = "block";
  }
}

window.onload = () => {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("graph").style.display = "none";
  document.getElementById("status").style.display = "none";
  document.getElementById("navigation").style.display = "none";
};


// ==== VIEW TOGGLING ====

function showDashboard() {
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("graph").style.display = "none";
}

function showGraph() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("graph").style.display = "block";
  drawGraph();
}


// ==== GRAPH FROM /api/data ====
function drawGraph() {
  const ctx = document.getElementById('waterChart').getContext('2d');

  // Example of fake/mock data
  const mockData = [
    { time: 'Mai 14', value: 1 },
    { time: 'Mai 15', value: 2 },
    { time: 'Mai 16', value: 4 },
    { time: 'Mai 17', value: 3 },
    { time: 'Mai 18', value: 6 }
  ];

  const labels = mockData.map(entry => entry.time);
  const data = mockData.map(entry => entry.value);

  if (window.myChart) {
    window.myChart.destroy(); // Destroy previous chart if it exists
  }

  window.myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Consommation d\'eau (L)',
        data: data,
        borderColor: 'blue',
        backgroundColor: 'rgba(173, 216, 230, 0.5)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

// ==== WEBSOCKET CONNECTION (after login) ====

function startWebSocket() {
  let ws = new WebSocket('wss://compteur.cielnewton.fr/mqtt/');

  ws.onopen = () => {
    document.getElementById("status").textContent = "✅ Connexion WebSocket réussie";
  };

  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === "live_update") updateWaterData(msg.data);
    if (msg.type === "valve_command") {
      document.getElementById("valveState").textContent =
        `Valve: ${msg.electrovalve ? "Ouverte" : "Fermée"}`;
    }
  };

  ws.onerror = err => {
    document.getElementById("status").textContent = "❌ Erreur WebSocket";
    console.error("WebSocket error:", err);
  };

  ws.onclose = () => {
    document.getElementById("status").textContent = "🔌 Déconnecté";
  };
}


// ==== UPDATE DASHBOARD TEXT ====

function updateWaterData(data) {
  document.getElementById("waterUsed").textContent = `💧 Utilisé: ${data.water_used} L`;
  document.getElementById("electrovalve").textContent =
    `🔧 Valve: ${data.electrovalve ? "Ouverte" : "Fermée"}`;
}


// ==== ELECTROVALVE CONTROL ====

function sendValveCommand(state) {
  if (currentMode === "absent") {
    alert("Mode absent activé. Ouverture désactivée.");
    return;
  }

  fetch("/api/valve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "supersecrettoken123"
    },
    body: JSON.stringify({ command: state })
  })
    .then(res => res.json())
    .then(data => console.log("Commande envoyée:", data))
    .catch(err => console.error("Erreur:", err));
}


// ==== MODE: PRESENT / ABSENT ====

let currentMode = "present";

function setMode(mode) {
  currentMode = mode;

  fetch("/api/mode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "supersecrettoken123"
    },
    body: JSON.stringify({ mode })
  })
    .then(res => res.json())
    .then(data => {
      console.log("Mode mis à jour:", data);
      if (mode === "absent") {
        closeElectrovalve();
        document.getElementById("valveOnBtn").disabled = true;
        document.getElementById("valveOffBtn").disabled = true;
      } else {
        document.getElementById("valveOnBtn").disabled = false;
        document.getElementById("valveOffBtn").disabled = false;
      }
    });
}

function closeElectrovalve() {
  fetch("/api/valve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "supersecrettoken123"
    },
    body: JSON.stringify({ command: 'off' })
  })
    .then(res => res.json())
    .then(data => console.log("Electrovanne fermée automatiquement:", data));
}
