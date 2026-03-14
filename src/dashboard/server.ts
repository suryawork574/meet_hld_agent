import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { resetDiagram, getPreviousDiagram, generateDiagram, generateSummary, generateAdvice, generateTasks } from '../analysis/diagram-generator.js';
import { saveMeetingToGCS, loadMeetingFromGCS, listMeetingsFromGCS, type MeetingData } from '../storage/gcs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);

// Generate a session secret from AUTH_TOKEN (so cookies can't be forged)
const SESSION_COOKIE = 'meet_hld_session';
function generateSessionValue(): string {
  return crypto.createHmac('sha256', config.authToken).update('session').digest('hex');
}

// Auth middleware — checks cookie or ?token= query param
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Skip auth if no AUTH_TOKEN is configured
  if (!config.authToken) return next();

  // Check if token is in query param — if valid, set cookie and redirect to clean URL
  const queryToken = req.query.token as string;
  if (queryToken === config.authToken) {
    res.cookie(SESSION_COOKIE, generateSessionValue(), {
      httpOnly: true,
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    // For API requests, just continue; for page requests, redirect to remove token from URL
    if (req.path.startsWith('/api/')) return next();
    const cleanUrl = req.path || '/';
    return res.redirect(cleanUrl);
  }

  // Check session cookie
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(cookieHeader.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k, v.join('=')];
  }));
  if (cookies[SESSION_COOKIE] === generateSessionValue()) {
    return next();
  }

  // Not authenticated — show login page
  res.status(401).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0;
               display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login { background: #16213e; padding: 40px; border-radius: 12px; text-align: center; max-width: 400px; }
        h2 { margin: 0 0 20px; }
        input { padding: 10px 14px; border: 1px solid #444; border-radius: 6px; background: #2d2d44;
                color: #e0e0e0; font-size: 14px; width: 100%; box-sizing: border-box; margin-bottom: 12px; }
        button { padding: 10px 20px; background: #4361ee; color: #fff; border: none; border-radius: 6px;
                 font-size: 14px; cursor: pointer; width: 100%; }
        button:hover { background: #3a56d4; }
        .error { color: #e87171; font-size: 13px; margin-top: 8px; display: none; }
      </style>
    </head>
    <body>
      <div class="login">
        <h2>Meet HLD Agent</h2>
        <p style="color:#aaa;font-size:13px;">Enter the auth token to access the dashboard</p>
        <input type="password" id="token" placeholder="Auth Token" autofocus>
        <button onclick="login()">Login</button>
        <div class="error" id="error">Invalid token</div>
      </div>
      <script>
        function login() {
          const token = document.getElementById('token').value.trim();
          if (token) window.location.href = '/?token=' + encodeURIComponent(token);
        }
        document.getElementById('token').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') login();
        });
      </script>
    </body>
    </html>
  `);
}

// Apply auth to all routes
app.use(authMiddleware);

const io = new SocketIOServer(server, {
  cors: { origin: '*' },
});

// Authenticate Socket.IO connections
io.use((socket, next) => {
  if (!config.authToken) return next();

  // Check token from query param (Socket.IO handshake)
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (token === config.authToken) return next();

  // Check session cookie
  const cookieHeader = socket.handshake.headers.cookie || '';
  const cookies = Object.fromEntries(cookieHeader.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k, v.join('=')];
  }));
  if (cookies[SESSION_COOKIE] === generateSessionValue()) return next();

  logger.warn('Socket.IO connection rejected — invalid token');
  next(new Error('Authentication required'));
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

export { io, server };
