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
  .option("local-host", {
    alias: "l",
    type: "string",
    description: "Local host address (default: 127.0.0.1)",
    default: "127.0.0.1",
  })
  .option("server", {
    alias: "s",
    type: "string",
    description: "Relay server URL",
    default: "http://localhost:3000",
  })
  .option("remote-port", {
    alias: "r",
    type: "number",
    description: "Specific public port to request on Relay",
  })
  .argv;

const LOCAL_PORT = argv.port;
const LOCAL_HOST = argv.localHost;
const RELAY_SERVER = argv.server;
// Support both camelCase and kebab-case access just in case
const REQUESTED_PORT = argv.remotePort || argv['remote-port'];

console.log(`\n=== NeonTunnel Client ===`);
console.log(`Target: ${LOCAL_HOST}:${LOCAL_PORT}`);
console.log(`Relay : ${RELAY_SERVER}`);
if (REQUESTED_PORT) console.log(`Request Public Port: ${REQUESTED_PORT}`);
console.log(`=========================\n`);

const socket = io(RELAY_SERVER);

socket.on("connect", () => {
  console.log("✅ Connected to Relay Server");
  // Always send the port request if it exists
  if (REQUESTED_PORT) {
    console.log(`[Debug] Requesting specific port: ${REQUESTED_PORT}`);
    socket.emit("register-tunnel", REQUESTED_PORT);
  } else {
    console.log(`[Debug] Requesting random port`);
    socket.emit("register-tunnel");
  }
});

socket.on("tunnel-created", ({ publicPort, tunnelId }) => {
  // Construct the public URL using the Relay Server hostname we connected to
  let publicHost = "localhost";
  try {
    const relayUrl = new URL(RELAY_SERVER);
    publicHost = relayUrl.hostname;
  } catch (e) {}

  // Handle case where server might still send 'url' (legacy) or 'publicPort'
  const finalPort = publicPort; 
  const fullUrl = `http://${publicHost}:${finalPort}`;

  console.log(`\n🎉 Tunnel Established!`);
  console.log(`🌍 Public URL: ${fullUrl}`);
  console.log(`🔑 Tunnel ID : ${tunnelId}\n`);
});

socket.on("tunnel-failed", ({ message }) => {
  console.error(`\n❌ Tunnel Creation Failed: ${message}`);
  process.exit(1);
});

// --- TCP Stream Implementation ---

socket.on("tcp-connection", ({ connId }) => {
  // New connection from outside to the Relay
  const local = new net.Socket();
  
  local.connect(LOCAL_PORT, LOCAL_HOST, () => {
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
