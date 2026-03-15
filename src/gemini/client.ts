import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../config/index.js';
import { buildSetupMessage, buildAudioChunkMessage } from './messages.js';
import type { GeminiServerContent, GeminiMessage } from './types.js';
import { logger } from '../utils/logger.js';

export interface GeminiClientEvents {
  ready: () => void;
  transcript: (text: string, isDesign: boolean) => void;
  turnComplete: () => void;
  error: (error: Error) => void;
  disconnected: () => void;
}

export class GeminiLiveClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private isReady = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private modelBuffer = '';       // model's response (only for [DESIGN] detection)

  // Transcription handling — Gemini inputAudioTranscription may send
  // cumulative text (full transcript so far) or incremental fragments.
  // We track the previous transcription to detect and handle both cases.
  private lastInputTranscription = '';  // last raw text received
  private pendingTranscript = '';       // new text waiting to be flushed
  private flushTimer: NodeJS.Timeout | null = null;
  private debugLogCount = 0;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('Connecting to Gemini Live API...');

      this.ws = new WebSocket(config.geminiWsUrl);

      this.ws.on('open', () => {
        logger.info('WebSocket connected, sending setup...');
        this.send(buildSetupMessage());
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const raw = data.toString();
          const message = JSON.parse(raw);

          this.handleMessage(message as GeminiServerContent, resolve);
        } catch (err) {
          logger.error({ err }, 'Failed to parse Gemini message');
        }
      });

      this.ws.on('error', (err) => {
        logger.error({ err }, 'Gemini WebSocket error');
        this.emit('error', err);
        if (!this.isReady) reject(err);
      });

      this.ws.on('close', (code, reason) => {
        logger.warn({ code, reason: reason.toString() }, 'Gemini WebSocket closed');
        this.isReady = false;
        this.emit('disconnected');
        this.attemptReconnect();
      });
    });
  }

  private handleMessage(message: GeminiServerContent, onReady?: (value: void) => void) {
    const msg = message as any;

    // Log full raw message for first 10 non-setup messages to debug structure
    if (this.debugLogCount < 10 && msg.setupComplete === undefined) {
      this.debugLogCount++;
      logger.info({ rawMessage: JSON.stringify(msg).substring(0, 1500) }, 'Gemini raw message');
    }

    if (msg.setupComplete !== undefined) {
      logger.info('Gemini Live API session ready');
      this.isReady = true;
      this.reconnectAttempts = 0;
      this.emit('ready');
      onReady?.();
      return;
    }

    const sc = msg.serverContent;

    // Input audio transcription — user's speech transcribed to text
    const inputTranscription = sc?.inputTranscription || msg.inputTranscription;
    if (inputTranscription) {
      const t = inputTranscription;
      const rawText = t.text || t.parts?.map((p: any) => p.text || '').join('') || (typeof t === 'string' ? t : '');
      if (rawText) {
        logger.info({ raw: rawText.substring(0, 300), prevLen: this.lastInputTranscription.length }, 'Input transcription received');

        // Detect if this is cumulative (starts with previous text) or incremental
        let newText: string;
        if (this.lastInputTranscription && rawText.startsWith(this.lastInputTranscription)) {
          // Cumulative — extract only the new part
          newText = rawText.substring(this.lastInputTranscription.length);
          logger.debug({ newText: newText.substring(0, 200) }, 'Cumulative transcription — extracted new portion');
        } else if (this.lastInputTranscription && rawText.length > this.lastInputTranscription.length * 0.8 && rawText.includes(this.lastInputTranscription.substring(0, 20))) {
          // Partial overlap — Gemini sometimes re-sends with minor corrections
          // Use the full new text as it's a corrected version
          newText = rawText;
          this.pendingTranscript = ''; // reset pending since this is a correction
          logger.debug('Corrected transcription received — using full text');
        } else {
          // Incremental fragment
          newText = rawText;
        }

        this.lastInputTranscription = rawText;

        if (newText.trim()) {
          // Add space between fragments if needed
          if (this.pendingTranscript && !this.pendingTranscript.endsWith(' ') && !newText.startsWith(' ')) {
            this.pendingTranscript += ' ';
          }
          this.pendingTranscript += newText;

          // Reset flush timer — wait for more fragments before emitting
          if (this.flushTimer) clearTimeout(this.flushTimer);
          this.flushTimer = setTimeout(() => this.flushTranscript(), 3000);
        }
      }
    }

    // Model response — check for [DESIGN] tag
    if (sc?.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.text) {
          this.modelBuffer += part.text;
          logger.debug({ modelText: part.text.substring(0, 200) }, 'Model turn text');
        }
      }
    }

    // Output transcription (model's audio response transcribed)
    const outputTranscription = sc?.outputTranscription || msg.outputTranscription;
    if (outputTranscription) {
      const ot = outputTranscription;
      if (ot.text) {
        this.modelBuffer += ot.text;
      } else if (ot.parts) {
        for (const part of ot.parts) {
          if (part.text) {
            this.modelBuffer += part.text;
          }
        }
      } else if (typeof ot === 'string') {
        this.modelBuffer += ot;
      }
    }

    // Turn complete — flush everything and check for [DESIGN]
    if (sc?.turnComplete || sc?.generationComplete) {
      this.flushTranscript();
      // Reset cumulative tracking on turn boundary
      this.lastInputTranscription = '';

      if (this.modelBuffer.includes('[DESIGN]')) {
        logger.info('Model flagged design discussion');
        this.emit('designDetected');
      }
      this.modelBuffer = '';
      this.emit('turnComplete');
    }
  }

  private flushTranscript() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }

    // Strip non-Latin characters but preserve basic punctuation and spacing
    const cleaned = this.pendingTranscript
      .replace(/[^\x00-\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned && cleaned.length > 1) {
      logger.info({ text: cleaned.substring(0, 200), len: cleaned.length }, 'Transcript flushed');
      this.emit('transcript', cleaned);
    }
    this.pendingTranscript = '';
  }

  sendAudioChunk(base64Data: string) {
    if (!this.isReady || !this.ws) return;
    this.send(buildAudioChunkMessage(base64Data));
  }

  send(message: GeminiMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send message, WebSocket not open');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    logger.info({ attempt: this.reconnectAttempts, delay }, 'Reconnecting...');

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(err => {
        logger.error({ err }, 'Reconnection failed');
      });
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isReady = false;
  }
}
