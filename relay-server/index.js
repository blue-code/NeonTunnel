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
    
    // Explicitly parse and validate
    const reqPortInt = requestedPort ? parseInt(requestedPort) : null;
    
    logger.info(`[REQUEST] Client ${socket.id} requested port: ${requestedPort} (Parsed: ${reqPortInt})`);

    try {
      if (reqPortInt && !isNaN(reqPortInt)) {
        // CASE 1: Requested specific port
        if (reqPortInt < MIN_PORT || reqPortInt > MAX_PORT) {
          logger.warn(`[FAIL] Port ${reqPortInt} out of range (${MIN_PORT}-${MAX_PORT})`);
          return socket.emit("tunnel-failed", { message: `Requested port ${reqPortInt} is out of allowed range (${MIN_PORT}-${MAX_PORT})` });
        }
        
        if (await isPortFree(reqPortInt)) {
          publicPort = reqPortInt;
          logger.info(`[SUCCESS] Port ${publicPort} is available.`);
        } else {
          logger.warn(`[FAIL] Port ${reqPortInt} is busy`);
          return socket.emit("tunnel-failed", { message: `Requested port ${reqPortInt} is already in use` });
        }
      } else {
        // CASE 2: Auto allocation
        logger.info(`[AUTO] Assigning random port...`);
        publicPort = await getFreePort();
      }
      
      // Create TCP Server for this tunnel
      const tcpServer = net.createServer((userSocket) => {
        const connId = uuidv4();
        
        // Notify Client of new connection
        socket.emit("tcp-connection", { connId });

        // Forward User -> Client
        userSocket.on("data", (data) => {
          socket.emit(`tcp-data-${connId}`, data);
        });

        // Handle Client -> User (via WS)
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

      tcpServer.listen(publicPort, () => {
        logger.info(`[TUNNEL START] :${publicPort} -> Client ${socket.id}`);
        
        tunnels[socket.id] = { publicPort, tcpServer };
        
        // Send just the port, let client construct the URL
        socket.emit("tunnel-created", { 
          publicPort: publicPort,
          tunnelId: socket.id 
        });
      });
      
      tcpServer.on('error', (err) => {
         logger.error(`[TCP ERROR] Failed to bind port ${publicPort}: ${err.message}`);
         socket.emit("tunnel-failed", { message: `Failed to bind port ${publicPort}` });
      });

    } catch (err) {
       logger.error(`[INTERNAL ERROR] ${err.message}`);
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
