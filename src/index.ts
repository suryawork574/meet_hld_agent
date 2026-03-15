import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { AudioCapture } from './meet/audio-capture.js';
import { GeminiLiveClient } from './gemini/client.js';
import { TranscriptBuffer } from './analysis/transcript-buffer.js';
import { detectDesignDiscussion } from './analysis/design-detector.js';
import { detectVoiceCommand } from './analysis/voice-command-detector.js';
import { generateDiagram, generateSummary, generateAdvice, generateTasks, getPreviousDiagram } from './analysis/diagram-generator.js';
import { startDashboard, emitTranscript, emitDiagramUpdate, emitSummaryUpdate, emitAdviceUpdate, emitTasksUpdate, emitStatus, emitVoiceCommand, onManualDiagramUpdate, onGetMeetingData, onClearAll, server } from './dashboard/server.js';
import { resetDiagram } from './analysis/diagram-generator.js';

async function main() {
  // Validate configuration
  config.validate();

  logger.info('=== GenAI Meet Diagram ===');
  logger.info('Starting up...');
  logger.info('Join your Google Meet manually and start the Chrome extension to capture audio.');

  // Start the dashboard
  const io = startDashboard();
  emitStatus('Starting');

  // Initialize components
  const transcriptBuffer = new TranscriptBuffer(60 * 60 * 1000); // Keep full session (60 min)
  const audioCapture = new AudioCapture(server);
  const geminiClient = new GeminiLiveClient();

  let lastDiagramGeneration = 0;
  let diagramGenerationInProgress = false;
  let latestSummary = '';
  let latestAdvice = '';
  let latestTasks = '';

  // Voice command detection — keep a sliding window of recent transcript chunks
  const recentChunks: string[] = [];
  const MAX_VOICE_CHUNKS = 10;
  let lastVoiceCommandTime = 0;
  const VOICE_COMMAND_COOLDOWN_MS = 10000;

  // Register callback so the save endpoint can access current meeting state
  onGetMeetingData(() => ({
    transcript: transcriptBuffer.getAll(),
    summary: latestSummary,
    diagram: getPreviousDiagram(),
    advice: latestAdvice,
    tasks: latestTasks,
  }));

  // Handle clear all from dashboard
  onClearAll(() => {
    transcriptBuffer.clear();
    resetDiagram();
    latestSummary = '';
    latestAdvice = '';
    latestTasks = '';
    logger.info('All data cleared');
  });

  // Handle verbatim transcripts from inputAudioTranscription
  geminiClient.on('transcript', (text: string) => {
    transcriptBuffer.add(text, false);
    emitTranscript(text, false);

    // --- Voice command detection ---
    recentChunks.push(text);
    if (recentChunks.length > MAX_VOICE_CHUNKS) recentChunks.shift();

    const now = Date.now();
    if (now - lastVoiceCommandTime > VOICE_COMMAND_COOLDOWN_MS) {
      const combined = recentChunks.join(' ');
      if (combined.toLowerCase().includes('sri') || combined.toLowerCase().includes('sree') || combined.toLowerCase().includes('shri') || combined.toLowerCase().includes('siri') || combined.toLowerCase().includes('three') || combined.toLowerCase().includes('tree') || combined.toLowerCase().includes('free') || combined.toLowerCase().includes('agent') || combined.toLowerCase().includes('hld')) {
        logger.info({ combinedText: combined.substring(0, 300) }, 'Potential voice command text detected — checking...');
      }
      const voiceCmd = detectVoiceCommand(combined);
      if (voiceCmd.detected) {
        lastVoiceCommandTime = now;
        recentChunks.length = 0;
        logger.info({ instruction: voiceCmd.instruction }, 'Voice command received — triggering diagram update');
        emitVoiceCommand(voiceCmd.triggerPhrase, voiceCmd.instruction);
        triggerVoiceCommandUpdate(voiceCmd.instruction);
      }
    }

    // Check design keywords against accumulated transcript (last 2 min)
    const recentText = transcriptBuffer.getRecentText(120000);
    const detection = detectDesignDiscussion(recentText);
    if (detection.isDesign) {
      logger.info({ keywords: detection.matchedKeywords }, 'Design discussion detected from accumulated transcript');
      triggerDiagramGeneration();
    }
  });

  // Handle model's [DESIGN] flag
  geminiClient.on('designDetected', () => {
    logger.info('Model flagged [DESIGN]');
    triggerDiagramGeneration();
  });

  // Real-time: only generate Mermaid diagram (defer summary/advice/tasks to stop-capture)
  async function triggerDiagramGeneration() {
    if (diagramGenerationInProgress) return;
    const now = Date.now();
    if (now - lastDiagramGeneration < config.designDetectDebounceMs) return;

    diagramGenerationInProgress = true;
    lastDiagramGeneration = now;
    try {
      const recentText = transcriptBuffer.getRecentText(120000);
      const diagram = await generateDiagram(recentText);

      if (diagram) {
        emitDiagramUpdate(diagram);
        logger.info('Diagram updated and sent to dashboard');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to generate diagram');
    } finally {
      diagramGenerationInProgress = false;
    }
  }

  // Voice command update
  async function triggerVoiceCommandUpdate(instruction: string) {
    if (diagramGenerationInProgress) {
      logger.info('Voice command received but generation already in progress');
      return;
    }
    diagramGenerationInProgress = true;
    try {
      const fullText = transcriptBuffer.getFullTranscript();
      if (!fullText || fullText.trim().length < 20) {
        logger.warn('Not enough transcript for voice command diagram update');
        return;
      }
      logger.info({ textLength: fullText.length, instruction }, 'Voice command diagram generation');

      const diagram = await generateDiagram(fullText, instruction);
      if (diagram) { emitDiagramUpdate(diagram); }
    } catch (err) {
      logger.error({ err }, 'Failed voice command diagram generation');
    } finally {
      diagramGenerationInProgress = false;
    }
  }

  // Manual update button
  onManualDiagramUpdate(async (suggestion: string) => {
    if (diagramGenerationInProgress) {
      logger.info('Manual update requested but generation already in progress');
      return;
    }
    diagramGenerationInProgress = true;
    try {
      const fullText = transcriptBuffer.getFullTranscript();
      if (!fullText || fullText.trim().length < 20) {
        logger.warn('Not enough transcript for manual diagram update');
        return;
      }
      logger.info({ textLength: fullText.length, suggestion }, 'Manual diagram generation with full session context');

      const diagram = await generateDiagram(fullText, suggestion);
      if (diagram) { emitDiagramUpdate(diagram); }
    } catch (err) {
      logger.error({ err }, 'Failed manual diagram generation');
    } finally {
      diagramGenerationInProgress = false;
    }
  });

  // Generate summary, advice, and tasks from full transcript on stop capture
  async function generatePostCaptureContent() {
    const fullText = transcriptBuffer.getFullTranscript();
    if (!fullText || fullText.trim().length < 20) {
      logger.warn('Not enough transcript for post-capture content generation');
      return;
    }

    logger.info({ textLength: fullText.length }, 'Generating summary, advice, and tasks from full transcript...');
    emitStatus('Generating Summary & Tasks...');

    try {
      const [summary, advice, tasks] = await Promise.all([
        generateSummary(fullText),
        generateAdvice(fullText),
        generateTasks(fullText),
      ]);

      if (summary) {
        latestSummary = summary;
        emitSummaryUpdate(summary);
        logger.info('Summary generated and sent to dashboard');
      }
      if (advice) {
        latestAdvice = advice;
        emitAdviceUpdate(advice);
        logger.info('Advice generated and sent to dashboard');
      }
      if (tasks) {
        latestTasks = tasks;
        emitTasksUpdate(tasks);
        logger.info('Tasks generated and sent to dashboard');
      }

      emitStatus('Content Ready');
      logger.info('Post-capture content generation complete');
    } catch (err) {
      logger.error({ err }, 'Failed to generate post-capture content');
      emitStatus('Generation Error');
    }
  }

  geminiClient.on('error', (err) => {
    logger.error({ err }, 'Gemini client error');
    emitStatus('Gemini Error');
  });

  geminiClient.on('disconnected', () => {
    emitStatus('Gemini Disconnected');
  });

  geminiClient.on('ready', () => {
    emitStatus('Gemini Connected');
  });

  // Connect to Gemini
  logger.info('Connecting to Gemini Live API...');
  emitStatus('Connecting to Gemini');
  await geminiClient.connect();

  // Start audio capture WebSocket server (waits for Chrome extension to connect)
  logger.info('Starting audio capture server on /audio-ws...');
  logger.info('Waiting for Chrome extension to connect...');
  emitStatus('Waiting for Extension');

  audioCapture.onStop(() => {
    logger.info('Extension stopped capture — generating summary, advice, and tasks...');
    emitStatus('Capture Stopped — Generating...');
    generatePostCaptureContent();
  });

  await audioCapture.startCapture((base64Chunk) => {
    geminiClient.sendAudioChunk(base64Chunk);
  });

  emitStatus('Live - Listening');
  logger.info('Extension connected! Listening to the meeting...');
  logger.info(`Dashboard: http://localhost:${config.dashboardPort}`);

  // Keep the process running
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      logger.info('Shutting down...');
      emitStatus('Shutting Down');
      audioCapture.stop();
      geminiClient.disconnect();
      resolve();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
