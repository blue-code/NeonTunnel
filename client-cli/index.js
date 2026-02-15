#!/usr/bin/env node

const io = require("socket.io-client");
const net = require("net");
const http = require("http");
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
    description: "Specific public port to request (TCP Mode)",
  })
  .option("subdomain", {
    alias: "d",
    type: "string",
    description: "Subdomain to request (HTTP Mode)",
  })
  .argv;

const LOCAL_PORT = argv.port;
const LOCAL_HOST = argv.localHost;
const RELAY_SERVER = argv.server;
const REMOTE_PORT = argv.remotePort || argv['remote-port'];
const SUBDOMAIN = argv.subdomain;

console.log(`\n=== NeonTunnel Client ===`);
console.log(`Target: ${LOCAL_HOST}:${LOCAL_PORT}`);
console.log(`Relay : ${RELAY_SERVER}`);
if (SUBDOMAIN) console.log(`Mode  : HTTP (Subdomain: ${SUBDOMAIN})`);
else if (REMOTE_PORT) console.log(`Mode  : TCP (Port: ${REMOTE_PORT})`);
else console.log(`Mode  : TCP (Random Port)`);
console.log(`=========================\n`);

const socket = io(RELAY_SERVER);

socket.on("connect", () => {
  console.log("✅ Connected to Relay Server");
  
  if (SUBDOMAIN) {
    socket.emit("register-tunnel", { subdomain: SUBDOMAIN });
  } else {
    // Legacy support: send port as first arg or object
    socket.emit("register-tunnel", REMOTE_PORT);
  }
});

socket.on("tunnel-created", ({ mode, url, publicPort, tunnelId }) => {
  console.log(`\n🎉 Tunnel Established!`);
  
  if (mode === 'http') {
    console.log(`🌍 Public URL: ${url}`);
  } else {
    // Construct TCP URL
    let publicHost = "localhost";
    try { publicHost = new URL(RELAY_SERVER).hostname; } catch (e) {}
    console.log(`🌍 Public Address: ${publicHost}:${publicPort}`);
  }
  
  console.log(`🔑 Tunnel ID : ${tunnelId}\n`);
});

socket.on("tunnel-failed", ({ message }) => {
  console.error(`\n❌ Tunnel Creation Failed: ${message}`);
  process.exit(1);
});

// --- TCP Handler ---
socket.on("tcp-connection", ({ connId }) => {
  const local = new net.Socket();
  local.connect(LOCAL_PORT, LOCAL_HOST, () => {});

  local.on("data", (data) => socket.emit("tcp-data", { connId, data }));
  local.on("close", () => socket.emit("tcp-close", { connId }));
  local.on("error", () => socket.emit("tcp-close", { connId }));

  socket.on(`tcp-data-${connId}`, (data) => { if (!local.destroyed) local.write(data); });
  socket.on(`tcp-close-${connId}`, () => local.end());
});

// --- HTTP Handler ---
socket.on("http-request", ({ id, method, url, headers }) => {
  // Proxy HTTP request to local server
  const options = {
    hostname: LOCAL_HOST,
    port: LOCAL_PORT,
    path: url,
    method: method,
    headers: headers,
  };

  const req = http.request(options, (res) => {
    socket.emit(`http-res-head-${id}`, {
      statusCode: res.statusCode,
      headers: res.headers,
    });

    res.on("data", (chunk) => socket.emit(`http-res-body-${id}`, chunk));
    res.on("end", () => socket.emit(`http-res-end-${id}`));
  });

  req.on("error", (e) => {
    // console.error(`Local Request Error: ${e.message}`);
    socket.emit(`http-res-head-${id}`, { statusCode: 502 });
    socket.emit(`http-res-end-${id}`);
  });

  // Stream body from Relay to Local
  socket.on(`http-req-body-${id}`, (chunk) => req.write(chunk));
  socket.on(`http-req-end-${id}`, () => req.end());
});

socket.on("error", (err) => console.error("❌ Socket Error:", err));
socket.on("disconnect", () => console.log("⚠️ Disconnected from Relay"));
