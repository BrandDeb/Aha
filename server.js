/**
 * NanoCLI Studio - WebSocket Server
 * 
 * This server handles WebSocket connections for real-time collaboration
 * and provides a fallback for environments that don't support WebSocket upgrades
 * in Next.js API routes.
 */

const http = require('http');
const { EventEmitter } = require('events');
const WebSocketServer = require('websocket').server;
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
// Next.js attaches its own 'upgrade' listener to `httpServer` (or, if unset, to
// the server of the first request it handles) and that listener closes any
// socket it doesn't recognise — including ours. Give it a detached emitter and
// forward only non-collaboration upgrades (e.g. HMR in development) to it.
const nextUpgrades = new EventEmitter();
const app = next({ dev, httpServer: nextUpgrades });
const handle = app.getRequestHandler();

const WS_PATH = '/api/ws';
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// Map to store connected clients by project
const projects = new Map();

/**
 * Origins allowed to open a collaboration socket. Defaults to the configured
 * base URL; set WS_ALLOWED_ORIGINS (comma separated) to override.
 */
function getAllowedOrigins() {
  const configured = process.env.WS_ALLOWED_ORIGINS || process.env.NEXT_PUBLIC_BASE_URL || '';
  return configured
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function isOriginAllowed(origin, host) {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, '');
  if (getAllowedOrigins().includes(normalized)) return true;
  // Same-origin requests are always allowed
  try {
    return new URL(normalized).host === host;
  } catch {
    return false;
  }
}

function isValidId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

// Create HTTP server
const server = http.createServer((req, res) => {
  // Handle Next.js requests
  handle(req, res);
});

// The websocket package insists on mounting to an HTTP server and claims every
// upgrade request. Mount it on a detached emitter instead and route upgrades
// ourselves so Next.js keeps handling its own (e.g. HMR in development).
const wsServer = new WebSocketServer({
  httpServer: new EventEmitter(),
  autoAcceptConnections: false,
  maxReceivedFrameSize: 64 * 1024,
  maxReceivedMessageSize: 256 * 1024,
});

// WebSocket connection handling
wsServer.on('request', (request) => {
  const url = new URL(request.httpRequest.url || '', `http://${request.httpRequest.headers.host}`);
  const projectId = url.searchParams.get('projectId');
  const clientId = url.searchParams.get('clientId');
  const clientName = (url.searchParams.get('name') || 'Anonymous').slice(0, MAX_NAME_LENGTH);
  
  if (!isOriginAllowed(request.origin, request.httpRequest.headers.host)) {
    request.reject(403, 'Origin not allowed');
    return;
  }

  if (!isValidId(projectId) || !isValidId(clientId)) {
    request.reject(400, 'Missing or invalid projectId or clientId');
    return;
  }

  if (projects.get(projectId)?.has(clientId)) {
    request.reject(409, 'clientId already connected');
    return;
  }
  
  const connection = request.accept(null, request.origin);
  
  // Create client info
  const client = {
    id: clientId,
    name: clientName,
    ws: connection,
    projectId,
  };
  
  // Initialize project map if not exists
  if (!projects.has(projectId)) {
    projects.set(projectId, new Map());
  }
  
  // Add client to project
  projects.get(projectId).set(clientId, client);
  
  // Send welcome message with current project state
  connection.sendUTF(JSON.stringify({
    type: 'connected',
    clientId,
    projectId,
    message: `Connected to project ${projectId}`,
  }));
  
  // Notify other clients in the same project
  broadcastToProject(projectId, {
    type: 'client_connected',
    clientId,
    name: clientName,
  }, clientId);
  
  // Handle incoming messages
  connection.on('message', (message) => {
    if (message.type !== 'utf8') return;
    try {
      const data = JSON.parse(message.utf8Data);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      
      // Forward message to all clients in the same project. Sender identity is
      // always taken from the connection so clients can't impersonate others.
      broadcastToProject(projectId, { ...data, clientId, projectId }, clientId);
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  // Handle connection close
  connection.on('close', () => {
    projects.get(projectId)?.delete(clientId);
    
    // Notify other clients
    broadcastToProject(projectId, {
      type: 'client_disconnected',
      clientId,
    });
    
    // Clean up empty projects
    if (projects.get(projectId)?.size === 0) {
      projects.delete(projectId);
    }
  });
  
  connection.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

/**
 * Broadcast message to all clients in a project
 */
function broadcastToProject(projectId, message, excludeClientId = null) {
  const projectClients = projects.get(projectId);
  if (projectClients) {
    const messageString = JSON.stringify(message);
    projectClients.forEach((client, id) => {
      if (id !== excludeClientId && client.ws?.connected) {
        try {
          client.ws.sendUTF(messageString);
        } catch (error) {
          console.error('Error broadcasting to client:', error);
        }
      }
    });
  }
}

// Start server
const PORT = process.env.PORT || 3000;

app.prepare().then(() => {
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url || '/', 'http://localhost');
    if (pathname === WS_PATH) {
      wsServer.handleUpgrade(req, socket);
    } else if (nextUpgrades.listenerCount('upgrade') > 0) {
      nextUpgrades.emit('upgrade', req, socket, head);
    } else {
      // Next.js registers its handler on the first HTTP request it serves
      socket.destroy();
    }
  });

  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
    console.log(`> WebSocket available at ws://localhost:${PORT}${WS_PATH}`);
  });
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down gracefully...');
  wsServer.shutDown();
  server.close(() => {
    process.exit(0);
  });
  // Idle keep-alive sockets would otherwise hold close() open indefinitely
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { server, wsServer, broadcastToProject };
