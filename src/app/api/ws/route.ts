import { NextRequest } from 'next/server';
import { WebSocketServer } from 'websocket';
import { IncomingMessage } from 'http';

const clients: Map<string, any> = new Map();
const projects: Map<string, Map<string, any>> = new Map();

function broadcastToProject(projectId: string, message: any, excludeClientId?: string) {
  const projectClients = projects.get(projectId);
  if (projectClients) {
    const messageString = JSON.stringify(message);
    projectClients.forEach((client, clientId) => {
      if (clientId !== excludeClientId && client.ws?.readyState === 1) {
        client.ws.send(messageString);
      }
    });
  }
}

function handleUpgrade(request: NextRequest) {
  // This is a simplified approach - in production, use a proper WebSocket server
  // Next.js doesn't natively support WebSocket upgrades in API routes
  // For production, use a separate WebSocket server or Vercel's edge functions
  return new Response(null, { status: 426, statusText: 'Upgrade Required' });
}

// For development/testing, we'll use a simple in-memory pub/sub
// In production, this should be replaced with a proper WebSocket server

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const clientId = searchParams.get('clientId');
  
  if (!projectId || !clientId) {
    return new Response(null, { status: 400 });
  }
  
  // This is a placeholder - Next.js API routes don't support WebSocket upgrades directly
  // For production, use a separate WebSocket server
  return new Response(null, { status: 426, statusText: 'Upgrade Required' });
}

// Export a WebSocket handler for use with a proper WebSocket server
export function setupWebSocketServer(server: any) {
  const wsServer = new WebSocketServer({
    server,
    path: '/api/ws',
  });
  
  wsServer.on('request', (request: IncomingMessage & { httpRequest: any }) => {
    const projectId = new URL(request.httpRequest.url || '').searchParams.get('projectId');
    const clientId = new URL(request.httpRequest.url || '').searchParams.get('clientId');
    
    if (!projectId || !clientId) {
      request.reject(400, 'Missing projectId or clientId');
      return;
    }
    
    const connection = request.accept(null, request.origin);
    
    clients.set(clientId, { ws: connection, projectId });
    
    if (!projects.has(projectId)) {
      projects.set(projectId, new Map());
    }
    projects.get(projectId)?.set(clientId, { ws: connection });
    
    // Send current project state to new client
    // In a real implementation, you'd fetch this from a database
    
    connection.on('message', (message: any) => {
      try {
        const data = JSON.parse(message.utf8Data || message);
        broadcastToProject(projectId, data, clientId);
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    connection.on('close', () => {
      clients.delete(clientId);
      projects.get(projectId)?.delete(clientId);
      
      // Notify other clients that this client disconnected
      broadcastToProject(projectId, {
        type: 'client_disconnected',
        clientId,
      });
    });
  });
  
  return wsServer;
}

export const config = {
  api: {
    bodyParser: false,
  },
};
