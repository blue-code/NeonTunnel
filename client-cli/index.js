#!/usr/bin/env node

const io = require("socket.io-client");
const net = require("net");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
  .option("port", {
    alias: "p",
    type: "number",
    description: "Local port to expose",
    demandOption: true,
  })
  .option("server", {
    alias: "s",
    type: "string",
    description: "Relay server URL",
    default: "http://localhost:3000",
  })
  .argv;

const LOCAL_PORT = argv.port;
const RELAY_SERVER = argv.server;

console.log(`\n=== NeonTunnel Client ===`);
console.log(`Target: localhost:${LOCAL_PORT}`);
console.log(`Relay : ${RELAY_SERVER}`);
console.log(`=========================\n`);

const socket = io(RELAY_SERVER);

socket.on("connect", () => {
  console.log("✅ Connected to Relay Server");
  socket.emit("register-tunnel"); // Request a new tunnel
});

socket.on("tunnel-created", ({ url, tunnelId }) => {
  console.log(`\n🎉 Tunnel Established!`);
  console.log(`🌍 Public URL: ${url}`);
  console.log(`🔑 Tunnel ID : ${tunnelId}\n`);
});

// Handle incoming requests from Relay
socket.on("request", ({ id, method, url, headers, body }) => {
  // console.log(`[REQ] ${method} ${url}`);

  // Forward to Local Server
  const localClient = net.connect(LOCAL_PORT, "127.0.0.1", () => {
    // Construct simplified HTTP request (naïve implementation)
    // In a robust version, we should use a proper HTTP proxy agent or stream piping
    // For TCP tunneling (which is what ngrok does for arbitrary protocols), we need stream piping.
    // However, outray/ngrok http mode parses HTTP.
    
    // Let's implement TCP tunneling mode for simplicity and robustness first.
    // Wait... the relay sends "request" event? That implies HTTP parsing.
    // Let's switch to pure TCP streaming for better compatibility.
  });
  
  // Re-thinking: Pure TCP Tunnel is better.
  // 1. Relay listens on a public port (or subdomains).
  // 2. Client connects to Relay via WebSocket.
  // 3. When User connects to Relay Public Port -> Relay streams data over WS -> Client -> Local Port.
});

// --- TCP Stream Implementation ---
// Re-implementing with TCP Stream logic for robust tunneling

socket.on("tcp-connection", ({ connId }) => {
  // New connection from outside to the Relay
  const local = new net.Socket();
  
  local.connect(LOCAL_PORT, "127.0.0.1", () => {
    // console.log(`[CONN] New connection ${connId} -> Local:${LOCAL_PORT}`);
  });

  local.on("data", (data) => {
    socket.emit("tcp-data", { connId, data });
  });

  local.on("close", () => {
    socket.emit("tcp-close", { connId });
  });

  local.on("error", (err) => {
    // console.error(`[ERR] Local connection error: ${err.message}`);
    socket.emit("tcp-close", { connId });
  });

  // Receive data from Relay for this connection
  socket.on(`tcp-data-${connId}`, (data) => {
    if (!local.destroyed) local.write(data);
  });

  socket.on(`tcp-close-${connId}`, () => {
    local.end();
  });
});

socket.on("error", (err) => {
  console.error("❌ Socket Error:", err);
});

socket.on("disconnect", () => {
  console.log("⚠️ Disconnected from Relay");
});
