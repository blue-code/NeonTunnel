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
const MIN_PORT = 10000;
const MAX_PORT = 20000;

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

// Helper: Find free port
function getFreePort() {
  return new Promise((resolve, reject) => {
    const port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(getFreePort())); // Retry
  });
}

io.on("connection", (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on("register-tunnel", async () => {
    const publicPort = await getFreePort();
    
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
      logger.info(`Tunnel created: :${publicPort} -> Client ${socket.id}`);
      
      tunnels[socket.id] = { publicPort, tcpServer };
      
      // Send Public URL to Client
      // In prod, replace 'localhost' with actual Public IP or Domain
      const publicHost = "localhost"; 
      socket.emit("tunnel-created", { 
        url: `http://${publicHost}:${publicPort}`, // For HTTP
        rawUrl: `${publicHost}:${publicPort}`,     // For TCP
        tunnelId: socket.id 
      });
    });
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
