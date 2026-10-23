/**
 * NanoCLI Studio - WebSocket Server
 * 
 * This server handles WebSocket connections for real-time collaboration
 * and provides a fallback for environments that don't support WebSocket upgrades
 * in Next.js API routes.
 */

// Node (22+) keeps compiled code between starts: the server starts about a quarter faster after the first time
try {
  const home = process.env.NANOCLI_HOME || require('node:path').join(require('node:os').homedir(), '.nanocli');
  require('node:module').enableCompileCache?.(process.env.NODE_COMPILE_CACHE || require('node:path').join(home, 'cache', 'node-compile'));
} catch {
  // an older Node, or a read-only home: start without it
}

const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
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

/**
 * DNS-rebinding defence (mirrors src/lib/host.ts): a page on evil.example can
 * point its domain at 127.0.0.1, and then its Origin and Host agree. The Host
 * header still names evil.example, so only this machine's names and the
 * configured site are accepted.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const hostnameOf = (host) => (host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, ''));
function isTrustedHost(hostHeader) {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader.toLowerCase());
  if (LOCAL_HOSTS.has(name)) return true;
  const allowed = (process.env.ALLOWED_HOSTS || '').split(',').map((h) => hostnameOf(h.trim().toLowerCase())).filter(Boolean);
  if (allowed.includes(name)) return true;
  try {
    return new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').hostname.toLowerCase() === name;
  } catch {
    return false;
  }
}

const MAX_CLIENTS_PER_ROOM = Number(process.env.WS_MAX_CLIENTS_PER_ROOM) || 16;
const MAX_ROOMS = Number(process.env.WS_MAX_ROOMS) || 1000;
/** Messages per second a connection may send (bursts up to twice that); edits are sent per keystroke batch */
const MESSAGES_PER_SECOND = 40;

function isValidId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

// Create HTTP server
/**
 * Next serves its static chunks gzip-compressed; browsers that accept brotli get a copy about 17% smaller.
 * The files never change (their names are content hashes), so each is compressed once, at the highest
 * quality, in the background, and kept in memory; until it is ready Next serves the gzip copy as usual.
 */
const STATIC_ROOT = path.join(process.cwd(), '.next', 'static');
const BROTLI_LIMIT = 64 * 1024 * 1024;
const brotliCache = new Map(); // relative path → Buffer, or null while compressing
let brotliBytes = 0;

function serveBrotli(req, res) {
  if (dev || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const url = req.url || '';
  if (!url.startsWith('/_next/static/') || !/\bbr\b/.test(String(req.headers['accept-encoding'] || ''))) return false;
  const rel = url.slice('/_next/static/'.length).split('?')[0];
  // Only plain chunk names: nothing encoded, nothing that could leave the folder
  if (!/^[A-Za-z0-9_][\w.-]*(\/[A-Za-z0-9_][\w.-]*)*\.(js|css)$/.test(rel)) return false;
  const cached = brotliCache.get(rel);
  if (cached) {
    res.writeHead(200, {
      'Content-Type': rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
      'Content-Encoding': 'br',
      'Content-Length': cached.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Vary': 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : cached);
    return true;
  }
  if (cached === undefined && brotliBytes < BROTLI_LIMIT) {
    brotliCache.set(rel, null);
    fs.readFile(path.join(STATIC_ROOT, rel), (readError, data) => {
      if (readError) return brotliCache.delete(rel);
      zlib.brotliCompress(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }, (error, compressed) => {
        if (error || brotliBytes + compressed.length > BROTLI_LIMIT) return brotliCache.delete(rel);
        brotliBytes += compressed.length;
        brotliCache.set(rel, compressed);
      });
    });
  }
  return false;
}

const server = http.createServer((req, res) => {
  if (serveBrotli(req, res)) return;
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
  
  if (!isOriginAllowed(request.origin, request.httpRequest.headers.host) || !isTrustedHost(request.httpRequest.headers.host)) {
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
  if ((projects.get(projectId)?.size ?? 0) >= MAX_CLIENTS_PER_ROOM || (!projects.has(projectId) && projects.size >= MAX_ROOMS)) {
    request.reject(503, 'Too many connections');
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
  
  // Handle incoming messages: a token bucket per connection, so one client can't flood a room
  let tokens = MESSAGES_PER_SECOND * 2;
  let refilled = Date.now();
  connection.on('message', (message) => {
    if (message.type !== 'utf8') return;
    const now = Date.now();
    tokens = Math.min(MESSAGES_PER_SECOND * 2, tokens + ((now - refilled) / 1000) * MESSAGES_PER_SECOND);
    refilled = now;
    if (tokens < 1) return;
    tokens -= 1;
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
// Loopback only by default. The studio can run Python and compile code, so it must not be
// reachable from the rest of the network unless the operator says so (HOST=0.0.0.0).
const HOST = process.env.HOST || '127.0.0.1';

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

  server.listen(PORT, HOST, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
    console.log(`> WebSocket available at ws://localhost:${PORT}${WS_PATH}`);
    if (process.env.NANOCLI_PYTHON !== '0') {
      console.log('> Python (uv) is enabled: programs run on this machine. Set NANOCLI_PYTHON=0 to turn it off.');
      if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
        console.warn(`> WARNING: listening on ${HOST} with Python enabled. Anyone who can reach this port can run code on this machine.`);
      }
    }
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

// A crash is better restarted than limped along: log it, then exit so the supervisor
// (npm run dev / npm start) or the container runtime starts a clean process
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { server, wsServer, broadcastToProject };
