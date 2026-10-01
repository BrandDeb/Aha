/**
 * WebSocket client utilities for real-time collaboration
 */

interface WebSocketMessageBase {
  type: 'cursor' | 'selection' | 'edit' | 'client_connected' | 'client_disconnected' | 'sync' | 'chat' | 'error';
  clientId?: string;
  projectId?: string;
  content?: string;
  position?: { line: number; column: number };
  selection?: { start: { line: number; column: number }; end: { line: number; column: number } };
  timestamp?: number;
  fileId?: string;
}

type WebSocketMessage = WebSocketMessageBase & {
  [key: string]: unknown;
};

interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursorPosition?: { line: number; column: number };
  selection?: { start: { line: number; column: number }; end: { line: number; column: number } };
  lastActive: number;
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private projectId: string = '';
  private clientId: string = '';
  private clientName: string = '';
  private collaborators: Map<string, Collaborator> = new Map();
  private messageQueue: WebSocketMessage[] = [];
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  
  private eventListeners: Map<string, ((message: WebSocketMessage) => void)[]> = new Map();
  
  constructor(projectId: string, clientId: string, clientName: string = 'Anonymous') {
    this.projectId = projectId;
    this.clientId = clientId;
    this.clientName = clientName;
    this.generateClientColor();
  }
  
  private generateClientColor(): string {
    const colors = [
      '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
      '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
      '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
    ];
    let hash = 0;
    for (let i = 0; i < this.clientId.length; i++) {
      hash = this.clientId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }
  
  connect(url: string = ''): void {
    const wsUrl = url || this.buildWebSocketUrl();
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        console.log('WebSocket connected');
        
        // Send initial sync message
        this.send({
          type: 'client_connected',
          clientId: this.clientId,
          projectId: this.projectId,
          name: this.clientName,
        });
        
        // Process queued messages
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift()!;
          this.send(message);
        }
        
        this.emit('connected');
      };
      
      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.emit('disconnected');
        this.attemptReconnect();
      };
      
      this.ws.onerror = (error: Event) => {
        console.error('WebSocket error:', error);
        this.emit('error', { type: 'error', content: (error as unknown as Error).message } as WebSocketMessage);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.emit('error', { type: 'error', content: 'Failed to connect' } as WebSocketMessage);
    }
  }
  
  private buildWebSocketUrl(): string {
    const baseUrl = process.env.NEXT_PUBLIC_WS_URL || 
      (typeof window !== 'undefined' ? 
        (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host :
        'ws://localhost:3000');
    
    return `${baseUrl}/api/ws?projectId=${this.projectId}&clientId=${this.clientId}&name=${encodeURIComponent(this.clientName)}`;
  }
  
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      
      setTimeout(() => {
        console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
        this.connect();
      }, delay);
    } else {
      console.log('Max reconnection attempts reached');
      this.emit('error', { 
        type: 'error', 
        content: 'Failed to reconnect after multiple attempts' 
      } as WebSocketMessage);
    }
  }
  
  send(message: WebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        this.messageQueue.push(message);
      }
    } else {
      this.messageQueue.push(message);
      if (this.ws?.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    }
  }
  
  private handleMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'client_connected':
        this.collaborators.set(message.clientId!, {
          id: message.clientId!,
          name: message.content || 'Anonymous',
          color: this.generateColorForClient(message.clientId!),
          lastActive: Date.now(),
        });
        this.emit('collaborator_joined', message);
        break;
        
      case 'client_disconnected':
        this.collaborators.delete(message.clientId!);
        this.emit('collaborator_left', message);
        break;
        
      case 'cursor':
      case 'selection':
        if (message.clientId && message.clientId !== this.clientId) {
          const collaborator = this.collaborators.get(message.clientId);
          if (collaborator) {
            if (message.type === 'cursor' && message.position) {
              collaborator.cursorPosition = message.position;
            }
            if (message.type === 'selection' && message.selection) {
              collaborator.selection = message.selection;
            }
            collaborator.lastActive = Date.now();
            this.emit('collaborator_update', { ...message, collaborator } as unknown as WebSocketMessage);
          }
        }
        break;
        
      case 'edit':
      case 'sync':
        this.emit('content_update', message);
        break;
        
      case 'chat':
        this.emit('chat_message', message);
        break;
        
      case 'error':
        this.emit('error', message);
        break;
        
      default:
        this.emit(message.type, message);
    }
  }
  
  private generateColorForClient(clientId: string): string {
    const colors = [
      '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
      '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
    ];
    let hash = 0;
    for (let i = 0; i < clientId.length; i++) {
      hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }
  
  on(event: string, callback: (message: WebSocketMessage) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }
  
  off(event: string, callback: (message: WebSocketMessage) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }
  
  private emit(event: string, message?: WebSocketMessage): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(message || { type: 'sync' } as WebSocketMessage));
    }
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.collaborators.clear();
    this.messageQueue = [];
  }
  
  getCollaborators(): Collaborator[] {
    return Array.from(this.collaborators.values());
  }
  
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export { WebSocketManager, type WebSocketMessage, type Collaborator };
