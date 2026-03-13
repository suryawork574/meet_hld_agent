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
  private transcriptBuffer = '';  // accumulates word fragments into sentences
  private flushTimer: NodeJS.Timeout | null = null;
  private modelBuffer = '';       // model's response (only for [DESIGN] detection)

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
    if (message.setupComplete !== undefined) {
      logger.info('Gemini Live API session ready');
      this.isReady = true;
      this.reconnectAttempts = 0;
      this.emit('ready');
      onReady?.();
      return;
    }

    // Input audio transcription — accumulate fragments, flush as sentences
    const sc = message.serverContent as any;
    if (sc?.inputTranscription) {
      const t = sc.inputTranscription;
      // Handle all possible shapes: { text }, { parts: [{ text }] }, or string
      const fragment = t.text || t.parts?.map((p: any) => p.text || '').join('') || (typeof t === 'string' ? t : '');
      if (fragment) {
        this.transcriptBuffer += fragment;
        // Reset flush timer — flush after 2s of silence (no new fragments)
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flushTranscript(), 2000);
        // Also flush on sentence-ending punctuation
        if (/[.!?]$/.test(this.transcriptBuffer.trim())) {
          this.flushTranscript();
        }
      }
    }

    // Model response — only check for [DESIGN] tag
    if (sc?.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.text) {
          this.modelBuffer += part.text;
        }
      }
    }

    if (sc?.outputTranscription) {
      const ot = sc.outputTranscription;
      if (ot.parts) {
        for (const part of ot.parts) {
          if (part.text) {
            this.modelBuffer += part.text;
          }
        }
      } else if (typeof ot === 'string') {
        this.modelBuffer += ot;
      }
    }

    if (message.serverContent?.turnComplete) {
      // Flush any remaining transcript fragments
      this.flushTranscript();
      // Check if model flagged this as design discussion
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
    // Strip non-Latin characters (Kannada, Hindi, etc.) — keep only English/Latin + basic punctuation/numbers
    const englishOnly = this.transcriptBuffer.replace(/[^\x00-\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (englishOnly) {
      logger.info({ text: englishOnly.substring(0, 150) }, 'Transcript flushed');
      this.emit('transcript', englishOnly);
    }
    this.transcriptBuffer = '';
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
    this.maxReconnectAttempts = 0; // prevent reconnect on intentional close
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isReady = false;
  }
}
