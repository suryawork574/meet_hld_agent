import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, unlinkSync, existsSync, readdirSync, rmdirSync, type WriteStream } from 'fs';
import path from 'path';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const RECORDINGS_DIR = path.resolve('recordings');

export class AudioCapture {
  private ffmpegProcess: ChildProcess | null = null;
  private wss: WebSocketServer;
  private onChunkCallback: ((base64Chunk: string) => void) | null = null;
  private bytesPerChunk: number;
  private rawFileStream: WriteStream | null = null;
  private pcmFileStream: WriteStream | null = null;
  private rawFilePath: string | null = null;
  private pcmFilePath: string | null = null;
  private onStopCallback: (() => void) | null = null;
  private capturing = false;

  constructor(httpServer: HttpServer) {
    this.bytesPerChunk = 16000 * 2 * 1 * (config.audioChunkMs / 1000);

    // Verify auth token on WebSocket upgrade
    const verifyClient = (info: { origin: string; req: IncomingMessage; secure: boolean }) => {
      if (!config.authToken) return true;
      const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');
      if (token === config.authToken) return true;
      logger.warn({ origin: info.origin }, 'WebSocket connection rejected — invalid token');
      return false;
    };

    // Create WSS once — it stays alive for the lifetime of the server
    this.wss = new WebSocketServer({ server: httpServer, path: '/audio-ws', verifyClient });
    logger.info({ path: '/audio-ws' }, 'Audio WS server listening (persistent)');
  }

  onStop(callback: () => void) {
    this.onStopCallback = callback;
  }

  async startCapture(onChunk: (base64Chunk: string) => void): Promise<void> {
    this.onChunkCallback = onChunk;
    this.capturing = false;

    // Handle incoming connections (new or reconnect)
    this.wss.on('connection', (ws) => {
      logger.info('Chrome extension audio WebSocket connected!');

      // Start a new capture session
      this.startSession();

      ws.on('message', (data: Buffer) => {
        this.rawFileStream?.write(data);
        this.ffmpegProcess?.stdin?.write(data);
      });

      ws.on('close', () => {
        logger.info('Chrome extension disconnected — stopping capture session');
        this.stopSession();
        this.onStopCallback?.();
      });
    });

    // Wait for first extension connection
    await new Promise<void>(resolve => {
      this.wss.once('connection', () => {
        logger.info('Extension connected, audio capture pipeline active');
        resolve();
      });
    });
  }

  private startSession() {
    if (this.capturing) {
      this.stopSession();
    }
    this.capturing = true;

    // Create recordings directory
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.rawFilePath = path.join(RECORDINGS_DIR, `${timestamp}-raw.webm`);
    this.pcmFilePath = path.join(RECORDINGS_DIR, `${timestamp}-16khz.pcm`);

    this.rawFileStream = createWriteStream(this.rawFilePath);
    this.pcmFileStream = createWriteStream(this.pcmFilePath);
    logger.info({ rawFilePath: this.rawFilePath, pcmFilePath: this.pcmFilePath }, 'Saving audio recordings');

    // Start ffmpeg
    this.ffmpegProcess = spawn('ffmpeg', [
      '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1',
      '-acodec', 'pcm_s16le', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.ffmpegProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        logger.error({ msg: msg.slice(-200) }, 'ffmpeg error');
      }
    });

    // PCM -> Gemini + save to file
    let pcmBuffer = Buffer.alloc(0);
    let pcmChunksSent = 0;
    this.ffmpegProcess.stdout?.on('data', (data: Buffer) => {
      this.pcmFileStream?.write(data);
      pcmBuffer = Buffer.concat([pcmBuffer, data]);
      while (pcmBuffer.length >= this.bytesPerChunk) {
        const chunk = pcmBuffer.subarray(0, this.bytesPerChunk);
        pcmBuffer = pcmBuffer.subarray(this.bytesPerChunk);
        this.onChunkCallback?.(chunk.toString('base64'));
        pcmChunksSent++;
        if (pcmChunksSent % 40 === 0) {
          logger.info({ pcmChunksSent }, 'PCM chunks -> Gemini');
        }
      }
    });
  }

  private stopSession() {
    if (!this.capturing) return;
    this.capturing = false;

    logger.info('Stopping capture session...');
    if (this.rawFileStream) { this.rawFileStream.end(); this.rawFileStream = null; }
    if (this.pcmFileStream) { this.pcmFileStream.end(); this.pcmFileStream = null; }
    if (this.ffmpegProcess) {
      this.ffmpegProcess.stdin?.end();
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }

    this.deleteRecordings();
    logger.info('Capture session stopped and recordings deleted');
  }

  stop() {
    this.stopSession();
    this.onChunkCallback = null;
  }

  private deleteRecordings() {
    if (this.rawFilePath && existsSync(this.rawFilePath)) {
      try { unlinkSync(this.rawFilePath); logger.info({ file: this.rawFilePath }, 'Deleted raw recording'); } catch (e) { logger.error({ err: e }, 'Failed to delete raw recording'); }
      this.rawFilePath = null;
    }
    if (this.pcmFilePath && existsSync(this.pcmFilePath)) {
      try { unlinkSync(this.pcmFilePath); logger.info({ file: this.pcmFilePath }, 'Deleted PCM recording'); } catch (e) { logger.error({ err: e }, 'Failed to delete PCM recording'); }
      this.pcmFilePath = null;
    }

    try {
      if (existsSync(RECORDINGS_DIR) && readdirSync(RECORDINGS_DIR).length === 0) {
        rmdirSync(RECORDINGS_DIR);
        logger.info('Removed empty recordings directory');
      }
    } catch (_) { /* ignore */ }
  }
}
