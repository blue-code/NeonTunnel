const { Server } = require("socket.io");
const http = require("http");
const net = require("net");
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

const HTTP_PORT = process.env.PORT || 3000;
const MIN_PORT = 33000;
const MAX_PORT = 39000;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("NeonTunnel Relay Server Running");
});

const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8
});

// Active Tunnels: { socketId: { publicPort, tcpServer } }
const tunnels = {};

// Helper: Check if port is free
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

// Helper: Find free port
function getFreePort() {
  return new Promise(async (resolve, reject) => {
    // Try random ports
    for (let i = 0; i < 100; i++) {
      const port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
      if (await isPortFree(port)) return resolve(port);
    }
    reject("No free ports available");
  });
}

io.on("connection", (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on("register-tunnel", async (requestedPort) => {
    let publicPort;
    
    // Explicitly log the received port for debugging
    // logger.info(`[Debug] Request from ${socket.id}, requestedPort: ${requestedPort} (type: ${typeof requestedPort})`);

    if (requestedPort && requestedPort !== null) {
      const port = parseInt(requestedPort);
      
      if (isNaN(port) || port < MIN_PORT || port > MAX_PORT) {
        logger.warn(`Client ${socket.id} requested invalid port: ${port}`);
        return socket.emit("tunnel-failed", { message: `Requested port ${port} is out of allowed range (${MIN_PORT}-${MAX_PORT})` });
      }
      
      if (await isPortFree(port)) {
        publicPort = port;
      } else {
        logger.warn(`Client ${socket.id} requested busy port: ${port}`);
        return socket.emit("tunnel-failed", { message: `Requested port ${port} is already in use` });
      }
    } else {
      try {
        publicPort = await getFreePort();
      } catch (e) {
        return socket.emit("tunnel-failed", { message: "No free ports available on server" });
      }
    }
    
    // Create TCP Server for this tunnel
    const tcpServer = net.createServer((userSocket) => {
      const connId = uuidv4();
      
      socket.emit("tcp-connection", { connId });

      userSocket.on("data", (data) => {
        socket.emit(`tcp-data-${connId}`, data);
      });

      const dataHandler = ({ connId: id, data }) => {
        if (id === connId && !userSocket.destroyed) userSocket.write(data);
      };
      
      const closeHandler = ({ connId: id }) => {
        if (id === connId) userSocket.end();
      };

      socket.on("tcp-data", dataHandler);
      socket.on("tcp-close", closeHandler);

      userSocket.on("close", () => {
        socket.emit(`tcp-close-${connId}`);
        socket.off("tcp-data", dataHandler);
        socket.off("tcp-close", closeHandler);
      });

      userSocket.on("error", () => userSocket.end());
    });

    try {
      tcpServer.listen(publicPort, () => {
        logger.info(`Tunnel created: :${publicPort} -> Client ${socket.id}`);
        
        tunnels[socket.id] = { publicPort, tcpServer };
        
        const publicHost = "localhost"; // In prod, this should be the server IP/domain
        socket.emit("tunnel-created", { 
          url: `http://${publicHost}:${publicPort}`,
          rawUrl: `${publicHost}:${publicPort}`,
          tunnelId: socket.id 
        });
      });
      
      tcpServer.on('error', (err) => {
         logger.error(`Failed to bind port ${publicPort}: ${err.message}`);
         socket.emit("tunnel-failed", { message: `Failed to bind port ${publicPort}` });
      });

    } catch (err) {
       logger.error(`Server listen error: ${err.message}`);
       socket.emit("tunnel-failed", { message: "Internal Server Error" });
    }
  });

  socket.on("disconnect", () => {
    logger.info(`Client disconnected: ${socket.id}`);
    if (tunnels[socket.id]) {
      tunnels[socket.id].tcpServer.close();
      delete tunnels[socket.id];
    }
  });
});

httpServer.listen(HTTP_PORT, () => {
  logger.info(`🚀 NeonTunnel Relay Control Server running on port ${HTTP_PORT}`);
});
