import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { resetDiagram, getPreviousDiagram } from '../analysis/diagram-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (_req, res) => {
  res.json({ status: 'running', diagram: getPreviousDiagram() });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info({ id: socket.id }, 'Dashboard client connected');

  // Send current diagram if one exists
  const currentDiagram = getPreviousDiagram();
  if (currentDiagram) {
    socket.emit('diagram:update', currentDiagram);
  }

  socket.on('diagram:reset', () => {
    resetDiagram();
    io.emit('diagram:update', '');
    logger.info('Diagram reset by user');
  });

  socket.on('diagram:requestUpdate', (data?: { suggestion?: string }) => {
    const suggestion = data?.suggestion || '';
    logger.info({ suggestion }, 'Manual diagram update requested from dashboard');
    if (onManualUpdateCallback) {
      onManualUpdateCallback(suggestion);
    }
  });

  socket.on('disconnect', () => {
    logger.info({ id: socket.id }, 'Dashboard client disconnected');
  });
});

export function startDashboard(): SocketIOServer {
  server.listen(config.dashboardPort, () => {
    logger.info(`Dashboard running at http://localhost:${config.dashboardPort}`);
  });
  return io;
}

export function emitTranscript(text: string, isDesign: boolean) {
  io.emit('transcript', { text, isDesign, timestamp: Date.now() });
}

export function emitDiagramUpdate(mermaidCode: string) {
  io.emit('diagram:update', mermaidCode);
}

export function emitSummaryUpdate(summaryHtml: string) {
  io.emit('summary:update', summaryHtml);
}

export function emitAdviceUpdate(adviceHtml: string) {
  io.emit('advice:update', adviceHtml);
}

export function emitStatus(status: string) {
  io.emit('status', status);
}

let onManualUpdateCallback: ((suggestion: string) => void) | null = null;

export function onManualDiagramUpdate(callback: (suggestion: string) => void) {
  onManualUpdateCallback = callback;
}

export { io };
