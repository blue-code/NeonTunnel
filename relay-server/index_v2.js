const { Server } = require("socket.io");
const http = require("http");
const https = require("https");
const net = require("net");
const fs = require("fs");
const winston = require("winston");
const { v4: uuidv4 } = require("uuid");

// Logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

const HTTP_PORT = process.env.PORT || 80;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const CONTROL_PORT = process.env.CONTROL_PORT || 3000; // Socket.io control port
const DOMAIN = process.env.DOMAIN || "vozi.duckdns.org";

// SSL Config
const sslOptions = {};
try {
  if (process.env.SSL_KEY && process.env.SSL_CERT) {
    sslOptions.key = fs.readFileSync(process.env.SSL_KEY);
    sslOptions.cert = fs.readFileSync(process.env.SSL_CERT);
    logger.info("✅ SSL Certificate Loaded");
  }
} catch (e) {
  logger.warn("⚠️ SSL Certificate load failed. HTTPS will not work.");
}

// Active Tunnels
// { socketId: { type: 'tcp'|'http', publicPort?, subdomain?, clientSocket } }
const tunnels = {};
// Map subdomain to socketId for fast lookup
const subdomainMap = {}; 

// --- Control Server (Socket.IO) ---
const controlServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("NeonTunnel Control Server");
});
const io = new Server(controlServer, { cors: { origin: "*" }, maxHttpBufferSize: 1e8 });

// --- HTTP/HTTPS Proxy Server ---
const requestHandler = (req, res) => {
  const host = req.headers.host;
  if (!host) return res.end();

  // Extract subdomain (e.g. "myapp.vozi.duckdns.org" -> "myapp")
  const subdomain = host.split('.')[0];
  const socketId = subdomainMap[subdomain];

  if (socketId && tunnels[socketId]) {
    const clientSocket = tunnels[socketId].clientSocket;
    
    // Create a unique ID for this request
    const reqId = uuidv4();
    
    // Forward Request Metadata to Client
    const reqMeta = {
      id: reqId,
      method: req.method,
      url: req.url,
      headers: req.headers
    };
    
    clientSocket.emit("http-request", reqMeta);

    // Stream Body to Client
    req.on("data", (chunk) => {
      clientSocket.emit(`http-body-${reqId}`, chunk);
    });
    req.on("end", () => {
      clientSocket.emit(`http-end-${reqId}`);
    });

    // Handle Response from Client
    clientSocket.on(`http-res-head-${reqId}`, ({ statusCode, headers }) => {
      res.writeHead(statusCode, headers);
    });
    clientSocket.on(`http-res-body-${reqId}`, (chunk) => {
      res.write(chunk);
    });
    clientSocket.on(`http-res-end-${reqId}`, () => {
      res.end();
      clientSocket.removeAllListeners(`http-res-head-${reqId}`);
      clientSocket.removeAllListeners(`http-res-body-${reqId}`);
      clientSocket.removeAllListeners(`http-res-end-${reqId}`);
    });

  } else {
    res.writeHead(404);
    res.end("Tunnel not found");
  }
};

const proxyHttp = http.createServer(requestHandler);
let proxyHttps;
if (sslOptions.key) {
  proxyHttps = https.createServer(sslOptions, requestHandler);
}

// --- Socket.IO Logic ---
io.on("connection", (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Register Tunnel (TCP or HTTP/Subdomain)
  socket.on("register-tunnel", async (options = {}) => {
    // 1. Subdomain Mode (HTTP/HTTPS)
    if (options.subdomain) {
      const sub = options.subdomain.toLowerCase();
      if (subdomainMap[sub]) {
        return socket.emit("tunnel-failed", { message: `Subdomain '${sub}' is already taken.` });
      }
      
      subdomainMap[sub] = socket.id;
      tunnels[socket.id] = { type: 'http', subdomain: sub, clientSocket: socket };
      
      const protocol = sslOptions.key ? "https" : "http";
      const portSuffix = (protocol === "http" && HTTP_PORT === 80) || (protocol === "https" && HTTPS_PORT === 443) ? "" : `:${protocol === "http" ? HTTP_PORT : HTTPS_PORT}`;
      
      logger.info(`[TUNNEL] http://${sub}.${DOMAIN} -> Client ${socket.id}`);
      socket.emit("tunnel-created", {
        url: `${protocol}://${sub}.${DOMAIN}${portSuffix}`,
        mode: 'http'
      });
      return;
    }

    // 2. TCP Port Mode (Legacy)
    // ... (Existing TCP Logic reused here for backward compatibility)
    // For simplicity, let's keep the existing TCP logic as 'else' block or separate function.
    // ...
  });

  socket.on("disconnect", () => {
    if (tunnels[socket.id]) {
      const { subdomain } = tunnels[socket.id];
      if (subdomain) delete subdomainMap[subdomain];
      delete tunnels[socket.id];
    }
  });
});

// Start Servers
controlServer.listen(CONTROL_PORT, () => logger.info(`🎮 Control Server: :${CONTROL_PORT}`));
proxyHttp.listen(HTTP_PORT, () => logger.info(`🌐 HTTP Proxy: :${HTTP_PORT}`));
if (proxyHttps) proxyHttps.listen(HTTPS_PORT, () => logger.info(`🔒 HTTPS Proxy: :${HTTPS_PORT}`));
