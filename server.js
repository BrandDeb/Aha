/**
 * NanoCLI Studio - WebSocket Server
 * 
 * This server handles WebSocket connections for real-time collaboration
 * and provides a fallback for environments that don't support WebSocket upgrades
 * in Next.js API routes.
 */

const http = require('http');
const { WebSocketServer } = require('websocket');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Map to store connected clients by project
const projects = new Map();

// Create HTTP server
const server = http.createServer((req, res) => {
  // Handle Next.js requests
  handle(req, res);
});

// Create WebSocket server
const wsServer = new WebSocketServer({
  server,
  path: '/api/ws',
});

// WebSocket connection handling
wsServer.on('request', (request) => {
  const url = new URL(request.httpRequest.url || '', `http://${request.httpRequest.headers.host}`);
  const projectId = url.searchParams.get('projectId');
  const clientId = url.searchParams.get('clientId');
  const clientName = url.searchParams.get('name') || 'Anonymous';
  
  if (!projectId || !clientId) {
    request.reject(400, 'Missing projectId or clientId');
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
  connection.send(JSON.stringify({
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
    try {
      const data = JSON.parse(message.utf8Data || message);
      
      // Forward message to all clients in the same project
      broadcastToProject(projectId, data, clientId);
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
      if (id !== excludeClientId && client.ws?.readyState === 1) {
        try {
          client.ws.send(messageString);
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
  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
    console.log(`> WebSocket available at ws://localhost:${PORT}/api/ws`);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  wsServer.close();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  wsServer.close();
  server.close(() => {
    process.exit(0);
  });
});

module.exports = { server, wsServer, broadcastToProject };
