import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, unlinkSync, existsSync, readdirSync, rmdirSync, type WriteStream } from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const AUDIO_WS_PORT = 3001;
const RECORDINGS_DIR = path.resolve('recordings');

export class AudioCapture {
  private ffmpegProcess: ChildProcess | null = null;
  private wss: WebSocketServer | null = null;
  private onChunkCallback: ((base64Chunk: string) => void) | null = null;
  private bytesPerChunk: number;
  private rawFileStream: WriteStream | null = null;
  private pcmFileStream: WriteStream | null = null;
  private rawFilePath: string | null = null;
  private pcmFilePath: string | null = null;
  private onStopCallback: (() => void) | null = null;

  constructor() {
    this.bytesPerChunk = 16000 * 2 * 1 * (config.audioChunkMs / 1000);
  }

  onStop(callback: () => void) {
    this.onStopCallback = callback;
  }

  async startCapture(onChunk: (base64Chunk: string) => void): Promise<void> {
    this.onChunkCallback = onChunk;

    // Create recordings directory
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.rawFilePath = path.join(RECORDINGS_DIR, `${timestamp}-raw.webm`);
    this.pcmFilePath = path.join(RECORDINGS_DIR, `${timestamp}-16khz.pcm`);

    this.rawFileStream = createWriteStream(this.rawFilePath);
    this.pcmFileStream = createWriteStream(this.pcmFilePath);
    logger.info({ rawFilePath: this.rawFilePath, pcmFilePath: this.pcmFilePath }, 'Saving audio recordings');

    // 1. Start WebSocket server for extension audio data
    this.wss = new WebSocketServer({ port: AUDIO_WS_PORT });
    logger.info({ port: AUDIO_WS_PORT }, 'Audio WS server listening');

    // 2. Start ffmpeg
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

    // 3. Handle incoming audio from extension
    let totalBytes = 0;
    this.wss.on('connection', (ws) => {
      logger.info('Chrome extension audio WebSocket connected!');
      ws.on('message', (data: Buffer) => {
        totalBytes += data.length;
        this.rawFileStream?.write(data);
        this.ffmpegProcess?.stdin?.write(data);
        if (totalBytes % 20000 < data.length) {
          logger.info({ totalBytes, pcmChunksSent }, 'Audio stats');
        }
      });
      ws.on('close', () => {
        logger.info('Chrome extension disconnected — cleaning up recordings');
        this.stop();
        this.onStopCallback?.();
      });
    });

    // 4. Wait for extension connection
    await new Promise<void>(resolve => {
      this.wss!.once('connection', () => {
        logger.info('Extension connected, audio capture pipeline active');
        resolve();
      });
    });
  }

  stop() {
    logger.info('Stopping audio capture...');
    if (this.rawFileStream) { this.rawFileStream.end(); this.rawFileStream = null; }
    if (this.pcmFileStream) { this.pcmFileStream.end(); this.pcmFileStream = null; }
    if (this.wss) { this.wss.close(); this.wss = null; }
    if (this.ffmpegProcess) {
      this.ffmpegProcess.stdin?.end();
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
    this.onChunkCallback = null;

    // Delete local recording files
    this.deleteRecordings();
    logger.info('Audio capture stopped and recordings deleted');
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

    // Remove recordings directory if empty
    try {
      if (existsSync(RECORDINGS_DIR) && readdirSync(RECORDINGS_DIR).length === 0) {
        rmdirSync(RECORDINGS_DIR);
        logger.info('Removed empty recordings directory');
      }
    } catch (_) { /* ignore */ }
  }
}
