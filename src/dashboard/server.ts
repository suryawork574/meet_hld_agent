import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { resetDiagram, getPreviousDiagram, generateDiagram, generateSummary, generateAdvice, generateTasks } from '../analysis/diagram-generator.js';
import { saveMeetingToGCS, loadMeetingFromGCS, listMeetingsFromGCS, type MeetingData } from '../storage/gcs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

// Parse JSON bodies
app.use(express.json());

// ===== ALL API ROUTES BEFORE STATIC FILES =====

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
      tasks: meetingData.tasks,
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

// Regenerate content for a loaded meeting and save back to GCS
app.post('/api/meetings/regenerate', async (req, res) => {
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

    // Load existing meeting from GCS
    const existing = await loadMeetingFromGCS(meetingId as string, date as string);
    if (!existing) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    // Build full transcript text
    const transcriptText = existing.transcript
      .map(e => e.text)
      .join(' ');

    if (!transcriptText || transcriptText.trim().length < 20) {
      res.status(400).json({ error: 'Not enough transcript data to regenerate' });
      return;
    }

    logger.info({ meetingId, date, textLength: transcriptText.length }, 'Regenerating content for loaded meeting');

    // Regenerate all content in parallel
    const [diagram, summary, advice, tasks] = await Promise.all([
      generateDiagram(transcriptText),
      generateSummary(transcriptText),
      generateAdvice(transcriptText),
      generateTasks(transcriptText),
    ]);

    // Build updated meeting data
    const updated: MeetingData = {
      ...existing,
      diagram: diagram || existing.diagram,
      summary: summary || existing.summary,
      advice: advice || existing.advice,
      tasks: tasks || existing.tasks,
      savedAt: new Date().toISOString(),
    };

    // Save back to GCS
    await saveMeetingToGCS(updated);
    logger.info({ meetingId, date }, 'Regenerated meeting data saved to GCS');

    // Emit updates to all connected dashboard clients
    if (diagram) io.emit('diagram:update', diagram);
    if (summary) io.emit('summary:update', summary);
    if (advice) io.emit('advice:update', advice);
    if (tasks) io.emit('tasks:update', tasks);

    res.json({
      success: true,
      diagram: updated.diagram,
      summary: updated.summary,
      advice: updated.advice,
      tasks: updated.tasks,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to regenerate meeting content');
    res.status(500).json({ error: 'Failed to regenerate content' });
  }
});

// ===== STATIC FILES AFTER API ROUTES =====
app.use(express.static(path.join(__dirname, 'public')));

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

export function emitTasksUpdate(tasksHtml: string) {
  io.emit('tasks:update', tasksHtml);
}

export function emitStatus(status: string) {
  io.emit('status', status);
}

export function emitVoiceCommand(trigger: string, instruction: string) {
  io.emit('voiceCommand', { trigger, instruction, timestamp: Date.now() });
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
  tasks: string;
}) | null = null;

export function onGetMeetingData(callback: typeof getMeetingDataCallback) {
  getMeetingDataCallback = callback;
}

export { io };
