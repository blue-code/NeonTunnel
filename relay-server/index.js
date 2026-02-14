// ... (existing code)
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
    
    // Convert to int if string, and validate
    let reqPortInt = requestedPort ? parseInt(requestedPort) : null;
    if (isNaN(reqPortInt)) reqPortInt = null;

    logger.info(`[Request] Client ${socket.id} requesting port: ${reqPortInt || 'Auto'}`);

    if (reqPortInt) {
      if (reqPortInt < MIN_PORT || reqPortInt > MAX_PORT) {
        logger.warn(`Client ${socket.id} requested invalid port range: ${reqPortInt}`);
        return socket.emit("tunnel-failed", { message: `Requested port ${reqPortInt} is out of allowed range (${MIN_PORT}-${MAX_PORT})` });
      }
      
      if (await isPortFree(reqPortInt)) {
        publicPort = reqPortInt;
      } else {
        logger.warn(`Client ${socket.id} requested busy port: ${reqPortInt}`);
        return socket.emit("tunnel-failed", { message: `Requested port ${reqPortInt} is already in use` });
      }
    } else {
      try {
        publicPort = await getFreePort();
      } catch (e) {
        return socket.emit("tunnel-failed", { message: "No free ports available on server" });
      }
    }
// ... (rest of TCP logic)
