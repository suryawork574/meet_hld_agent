import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { resetDiagram, getPreviousDiagram } from '../analysis/diagram-generator.js';
import { saveMeetingToGCS, loadMeetingFromGCS, listMeetingsFromGCS, type MeetingData } from '../storage/gcs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

// Parse JSON bodies
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (_req, res) => {
  res.json({ status: 'running', diagram: getPreviousDiagram() });
});

// Save meeting data to GCS
app.post('/api/meetings/save', async (req, res) => {
  try {
    const { meetingId, date } = req.body;
    if (!meetingId || !date) {
      res.status(400).json({ error: 'meetingId and date are required' });
      return;
    }
    if (!config.gcsBucket) {
      res.status(500).json({ error: 'GCS_BUCKET_NAME not configured' });
      return;
    }

    // Get current state from the callback
    const meetingData = getMeetingDataCallback ? getMeetingDataCallback() : null;
    if (!meetingData) {
      res.status(400).json({ error: 'No meeting data available' });
      return;
    }

    const data: MeetingData = {
      meetingId,
      date,
      transcript: meetingData.transcript,
      summary: meetingData.summary,
      diagram: meetingData.diagram,
      advice: meetingData.advice,
      savedAt: new Date().toISOString(),
    };

    await saveMeetingToGCS(data);
    res.json({ success: true, path: `meetings/${date}/${meetingId}.json` });
  } catch (err) {
    logger.error({ err }, 'Failed to save meeting');
    res.status(500).json({ error: 'Failed to save meeting data' });
  }
});

// Load meeting data from GCS
app.get('/api/meetings/load', async (req, res) => {
  try {
    const { meetingId, date } = req.query;
    if (!meetingId || !date) {
      res.status(400).json({ error: 'meetingId and date query params are required' });
      return;
    }
    if (!config.gcsBucket) {
      res.status(500).json({ error: 'GCS_BUCKET_NAME not configured' });
      return;
    }

    const data = await loadMeetingFromGCS(meetingId as string, date as string);
    if (!data) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    res.json(data);
  } catch (err) {
    logger.error({ err }, 'Failed to load meeting');
    res.status(500).json({ error: 'Failed to load meeting data' });
  }
});

// List saved meetings
app.get('/api/meetings', async (_req, res) => {
  try {
    if (!config.gcsBucket) {
      res.status(500).json({ error: 'GCS_BUCKET_NAME not configured' });
      return;
    }
    const meetings = await listMeetingsFromGCS();
    res.json(meetings);
  } catch (err) {
    logger.error({ err }, 'Failed to list meetings');
    res.status(500).json({ error: 'Failed to list meetings' });
  }
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

// Callback to get current meeting data for saving
let getMeetingDataCallback: (() => {
  transcript: { text: string; timestamp: number; isDesign: boolean }[];
  summary: string;
  diagram: string;
  advice: string;
}) | null = null;

export function onGetMeetingData(callback: typeof getMeetingDataCallback) {
  getMeetingDataCallback = callback;
}

export { io };
