// ... (existing imports & config)

// ... (logger & state & control server)

// ... (proxy app)

// ... (startServers)

// ... (port helpers)

// --- 5. Main Socket Logic ---
io.on("connection", (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Broadcast function for Admin
  const broadcastUpdate = () => {
    const safeTunnels = {};
    for(const [id, t] of Object.entries(tunnels)) {
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
    socket.join("admin-room");
    broadcastUpdate();
  });

  socket.on("admin-kill", (targetId) => {
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) targetSocket.disconnect(true);
  });

  socket.on("admin-restart", () => {
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
      
      // Fix: Ensure tunnelId is explicitly passed
      socket.emit("tunnel-created", { 
          mode: 'http', 
          url: url,
          tunnelId: socket.id 
      });
      
      broadcastUpdate();
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
        
        // Fix: Ensure tunnelId is passed here too
        socket.emit("tunnel-created", { 
            mode: 'tcp', 
            publicPort: publicPort,
            tunnelId: socket.id
        });
        
        broadcastUpdate();
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
      broadcastUpdate();
    }
  });
});

// Init
startServers();
