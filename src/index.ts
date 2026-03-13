import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { AudioCapture } from './meet/audio-capture.js';
import { GeminiLiveClient } from './gemini/client.js';
import { TranscriptBuffer } from './analysis/transcript-buffer.js';
import { detectDesignDiscussion } from './analysis/design-detector.js';
import { generateDiagram, generateSummary, generateAdvice } from './analysis/diagram-generator.js';
import { startDashboard, emitTranscript, emitDiagramUpdate, emitSummaryUpdate, emitAdviceUpdate, emitStatus, onManualDiagramUpdate } from './dashboard/server.js';

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
  const audioCapture = new AudioCapture();
  const geminiClient = new GeminiLiveClient();

  let lastDiagramGeneration = 0;
  let diagramGenerationInProgress = false;

  // Handle verbatim transcripts from inputAudioTranscription
  geminiClient.on('transcript', (text: string) => {
    transcriptBuffer.add(text, false);
    emitTranscript(text, false);

    // Check design keywords against accumulated transcript (last 2 min), not just this fragment
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

  async function triggerDiagramGeneration() {
    if (diagramGenerationInProgress) return;
    const now = Date.now();
    if (now - lastDiagramGeneration < config.designDetectDebounceMs) return;

    diagramGenerationInProgress = true;
    lastDiagramGeneration = now;
    try {
      const recentText = transcriptBuffer.getRecentText(120000);

      // Generate diagram, summary, and advice in parallel
      const [diagram, summary, advice] = await Promise.all([
        generateDiagram(recentText),
        generateSummary(recentText),
        generateAdvice(recentText),
      ]);

      if (diagram) {
        emitDiagramUpdate(diagram);
        logger.info('Diagram updated and sent to dashboard');
      }
      if (summary) {
        emitSummaryUpdate(summary);
        logger.info('Summary updated and sent to dashboard');
      }
      if (advice) {
        emitAdviceUpdate(advice);
        logger.info('Advice updated and sent to dashboard');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to generate diagram/summary');
    } finally {
      diagramGenerationInProgress = false;
    }
  }

  // Manual update button — uses full session context, no debounce
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

      const [diagram, summary, advice] = await Promise.all([
        generateDiagram(fullText, suggestion),
        generateSummary(fullText),
        generateAdvice(fullText),
      ]);

      if (diagram) { emitDiagramUpdate(diagram); }
      if (summary) { emitSummaryUpdate(summary); }
      if (advice) { emitAdviceUpdate(advice); }
    } catch (err) {
      logger.error({ err }, 'Failed manual diagram generation');
    } finally {
      diagramGenerationInProgress = false;
    }
  });

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
  logger.info('Starting audio capture server on port 3001...');
  logger.info('Waiting for Chrome extension to connect...');
  emitStatus('Waiting for Extension');

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
