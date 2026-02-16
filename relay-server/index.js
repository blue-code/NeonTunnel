const { Server } = require("socket.io");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const winston = require("winston");
const { v4: uuidv4 } = require("uuid");

// --- Configuration ---
const DOMAIN = process.env.DOMAIN || "vozi.duckdns.org";
const CONTROL_PORT = process.env.PORT || 3000;
const HTTP_PORT = process.env.HTTP_PORT || 80;
const MIN_PORT = 33000; 
const MAX_PORT = 39000;

// Logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

// State
const tunnels = {};     
const subdomainMap = {}; 

// --- 1. Control Server (Socket.IO & Admin UI) ---
const controlServer = http.createServer((req, res) => {
  if (req.url === '/admin') {
    fs.readFile(path.join(__dirname, 'public/admin.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading dashboard'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(200);
    res.end("NeonTunnel Relay Server Running. Go to /admin for dashboard.");
  }
});

// Create IO instance immediately so it's available globally
const io = new Server(controlServer, { cors: { origin: "*" }, maxHttpBufferSize: 1e8 });

// --- 2. HTTP Proxy Logic ---
const app = (req, res) => {
  const host = req.headers.host;
  if (!host) return res.end();

  const subdomain = host.split('.')[0];
  const socketId = subdomainMap[subdomain];

  if (socketId && tunnels[socketId]) {
    const clientSocket = tunnels[socketId].clientSocket;
    const reqId = uuidv4();

    clientSocket.emit("http-request", {
      id: reqId,
      method: req.method,
      url: req.url,
      headers: req.headers
    });

    req.on("data", (chunk) => clientSocket.emit(`http-req-body-${reqId}`, chunk));
    req.on("end", () => clientSocket.emit(`http-req-end-${reqId}`));

    const headHandler = ({ statusCode, headers }) => res.writeHead(statusCode, headers);
    const bodyHandler = (chunk) => res.write(chunk);
    const endHandler = () => {
      res.end();
      cleanupListeners();
    };

    const cleanupListeners = () => {
      clientSocket.off(`http-res-head-${reqId}`, headHandler);
      clientSocket.off(`http-res-body-${reqId}`, bodyHandler);
      clientSocket.off(`http-res-end-${reqId}`, endHandler);
    };

    clientSocket.on(`http-res-head-${reqId}`, headHandler);
    clientSocket.on(`http-res-body-${reqId}`, bodyHandler);
    clientSocket.on(`http-res-end-${reqId}`, endHandler);

    req.on("close", cleanupListeners);

  } else {
    res.writeHead(404);
    res.end("Tunnel not found or inactive.");
  }
};

// --- 3. Server Setup (HTTP Only) ---
function startServers() {
  // Start Socket.IO Control Server
  controlServer.listen(CONTROL_PORT, () => {
    logger.info(`🎮 Control Server: :${CONTROL_PORT}`);
  });

  // Start HTTP Proxy Server
  http.createServer(app).listen(HTTP_PORT, () => {
    logger.info(`🌐 HTTP Proxy Server running on port ${HTTP_PORT}`);
  });
}

// --- 4. TCP Port Logic Helpers ---
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(() => resolve(true)); });
    server.listen(port);
  });
}

function getFreePort() {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < 100; i++) {
      const port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
      if (await isPortFree(port)) return resolve(port);
    }
    reject("No free ports available");
  });
}

// --- 5. Main Socket Logic ---
io.on("connection", (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Broadcast function for Admin
  const broadcastUpdate = () => {
    const safeTunnels = {};
    for(const [id, t] of Object.entries(tunnels)) {
        // Construct public endpoint string for display
        let endpoint = "";
        if (t.type === 'http') {
            endpoint = `http://${t.subdomain}.${DOMAIN}`;
        } else {
            endpoint = `:${t.publicPort}`;
        }

        safeTunnels[id] = { 
            type: t.type, 
            subdomain: t.subdomain, 
            publicPort: t.publicPort,
            clientId: id,
            endpoint: endpoint
        };
    }
    io.to("admin-room").emit("admin-update", { tunnels: safeTunnels });
  };

  // Admin Events
  socket.on("admin-join", () => {
    logger.info(`Admin joined: ${socket.id}`);
    socket.join("admin-room");
    broadcastUpdate(); // Send initial state
  });

  socket.on("admin-kill", (targetId) => {
    logger.warn(`[ADMIN] Killing tunnel ${targetId}`);
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.disconnect(true);
  });

  socket.on("admin-restart", () => {
    logger.warn(`[ADMIN] Server Restart Requested!`);
    process.exit(0);
  });

  socket.on("register-tunnel", async (options) => {
    // A. Subdomain Mode (HTTP Only)
    if (options && options.subdomain) {
      const sub = options.subdomain.toLowerCase();
      if (subdomainMap[sub]) {
        return socket.emit("tunnel-failed", { message: `Subdomain '${sub}' is taken.` });
      }
      
      subdomainMap[sub] = socket.id;
      tunnels[socket.id] = { type: 'http', subdomain: sub, clientSocket: socket };
      
      const url = `http://${sub}.${DOMAIN}`; 
      
      logger.info(`[HTTP TUNNEL] ${url} -> Client ${socket.id}`);
      socket.emit("tunnel-created", { mode: 'http', url });
      
      broadcastUpdate(); // Update Dashboard
      return;
    }

    // B. TCP Port Mode
    let publicPort;
    const requestedPort = (typeof options === 'object') ? options.port : options;
    const reqPortInt = requestedPort ? parseInt(requestedPort) : null;

    try {
      if (reqPortInt && !isNaN(reqPortInt)) {
        if (reqPortInt < MIN_PORT || reqPortInt > MAX_PORT) {
          return socket.emit("tunnel-failed", { message: `Port out of range (${MIN_PORT}-${MAX_PORT})` });
        }
        if (await isPortFree(reqPortInt)) {
          publicPort = reqPortInt;
        } else {
          return socket.emit("tunnel-failed", { message: `Port ${reqPortInt} is busy` });
        }
      } else {
        publicPort = await getFreePort();
      }

      const tcpServer = net.createServer((userSocket) => {
        const connId = uuidv4();
        socket.emit("tcp-connection", { connId });

        userSocket.on("data", (data) => socket.emit(`tcp-data-${connId}`, data));
        
        const dataHandler = ({ connId: id, data }) => { if (id === connId && !userSocket.destroyed) userSocket.write(data); };
        const closeHandler = ({ connId: id }) => { if (id === connId) userSocket.end(); };

        socket.on("tcp-data", dataHandler);
        socket.on("tcp-close", closeHandler);

        userSocket.on("close", () => {
          socket.emit(`tcp-close-${connId}`);
          socket.off("tcp-data", dataHandler);
          socket.off("tcp-close", closeHandler);
        });
        userSocket.on("error", () => userSocket.end());
      });

      tcpServer.listen(publicPort, () => {
        logger.info(`[TCP TUNNEL] :${publicPort} -> Client ${socket.id}`);
        tunnels[socket.id] = { type: 'tcp', publicPort, tcpServer };
        socket.emit("tunnel-created", { mode: 'tcp', publicPort });
        
        broadcastUpdate(); // Update Dashboard
      });

    } catch (err) {
      socket.emit("tunnel-failed", { message: err.message });
    }
  });

  socket.on("disconnect", () => {
    const tunnel = tunnels[socket.id];
    if (tunnel) {
      if (tunnel.type === 'http') delete subdomainMap[tunnel.subdomain];
      if (tunnel.type === 'tcp' && tunnel.tcpServer) tunnel.tcpServer.close();
      delete tunnels[socket.id];
      
      broadcastUpdate(); // Update Dashboard
    }
  });
});

// Init
startServers();
