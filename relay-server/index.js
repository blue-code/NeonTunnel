const { Server } = require("socket.io");
const http = require("http");
const https = require("https"); 
const net = require("net");
const fs = require("fs");
const winston = require("winston");
const { v4: uuidv4 } = require("uuid");
const greenlock = require("greenlock-express");

// --- Configuration ---
const DOMAIN = process.env.DOMAIN || "vozi.duckdns.org";
const EMAIL = process.env.EMAIL || "rockus@daum.net"; 
const CONTROL_PORT = process.env.PORT || 3000;
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

// --- 1. Control Server (Socket.IO) ---
const controlServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("NeonTunnel Control Server");
});
const io = new Server(controlServer, { cors: { origin: "*" }, maxHttpBufferSize: 1e8 });

// --- 2. HTTP/HTTPS Proxy Logic (Express-like Handler) ---
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

// --- 3. Greenlock Setup (Auto SSL) ---
function startServers() {
  // Start Socket.IO Control Server
  controlServer.listen(CONTROL_PORT, () => {
    logger.info(`🎮 Control Server: :${CONTROL_PORT}`);
  });

  // Start Greenlock (v4) with Dynamic Domain Approval
  try {
    const glx = greenlock.init({
        packageRoot: __dirname,
        configDir: "./greenlock.d",
        maintainerEmail: EMAIL,
        cluster: false
    });

    // Custom Manager Logic for Dynamic Subdomains
    // We override getOptions to dynamically approve any subdomain ending with our DOMAIN
    const originalGetOptions = glx.manager.getOptions.bind(glx.manager);
    glx.manager.getOptions = async function(opts) {
        if (opts.servername && opts.servername.endsWith(DOMAIN)) {
            return {
                subject: opts.servername,
                altnames: [opts.servername],
                agreeToTerms: true,
                subscriberEmail: EMAIL
            };
        }
        return originalGetOptions(opts);
    };

    glx.serve(app);
    
    logger.info(`🔒 Greenlock Auto-SSL Server Initialized (Ports 80/443)`);
  } catch (err) {
    logger.error(`Greenlock Init Failed: ${err.message}`);
    // Fallback
    http.createServer(app).listen(80, () => logger.warn("⚠️  Falling back to HTTP-only on port 80"));
  }
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

  socket.on("register-tunnel", async (options) => {
    // A. Subdomain Mode (HTTP/HTTPS)
    if (options && options.subdomain) {
      const sub = options.subdomain.toLowerCase();
      if (subdomainMap[sub]) {
        return socket.emit("tunnel-failed", { message: `Subdomain '${sub}' is taken.` });
      }
      
      subdomainMap[sub] = socket.id;
      tunnels[socket.id] = { type: 'http', subdomain: sub, clientSocket: socket };
      
      // HTTPS is active via Greenlock
      const url = `https://${sub}.${DOMAIN}`; 
      
      logger.info(`[HTTP TUNNEL] ${url} -> Client ${socket.id}`);
      socket.emit("tunnel-created", { mode: 'http', url });
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
    }
  });
});

// Init
startServers();
