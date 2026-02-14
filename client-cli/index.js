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
  .option("remote-port", {
    alias: "r",
    type: "number",
    description: "Specific public port to request on Relay",
  })
  .argv;

const LOCAL_PORT = argv.port;
const RELAY_SERVER = argv.server;
const REQUESTED_PORT = argv.remotePort; // Optional

console.log(`\n=== NeonTunnel Client ===`);
console.log(`Target: localhost:${LOCAL_PORT}`);
console.log(`Relay : ${RELAY_SERVER}`);
if (REQUESTED_PORT) console.log(`Request Public Port: ${REQUESTED_PORT}`);
console.log(`=========================\n`);

const socket = io(RELAY_SERVER);

socket.on("connect", () => {
  console.log("✅ Connected to Relay Server");
  socket.emit("register-tunnel", REQUESTED_PORT); // Send requested port
});

socket.on("tunnel-created", ({ url, tunnelId }) => {
  console.log(`\n🎉 Tunnel Established!`);
  console.log(`🌍 Public URL: ${url}`);
  console.log(`🔑 Tunnel ID : ${tunnelId}\n`);
});

socket.on("tunnel-failed", ({ message }) => {
  console.error(`\n❌ Tunnel Creation Failed: ${message}`);
  process.exit(1);
});

// ... (TCP Stream Implementation remains same)
socket.on("tcp-connection", ({ connId }) => {
  const local = new net.Socket();
  local.connect(LOCAL_PORT, "127.0.0.1", () => {});

  local.on("data", (data) => {
    socket.emit("tcp-data", { connId, data });
  });

  local.on("close", () => {
    socket.emit("tcp-close", { connId });
  });

  local.on("error", (err) => {
    socket.emit("tcp-close", { connId });
  });

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
