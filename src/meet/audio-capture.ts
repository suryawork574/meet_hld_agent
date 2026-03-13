import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
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

  constructor() {
    this.bytesPerChunk = 16000 * 2 * 1 * (config.audioChunkMs / 1000);
  }

  async startCapture(onChunk: (base64Chunk: string) => void): Promise<void> {
    this.onChunkCallback = onChunk;

    // Create recordings directory
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rawFilePath = path.join(RECORDINGS_DIR, `${timestamp}-raw.webm`);
    const pcmFilePath = path.join(RECORDINGS_DIR, `${timestamp}-16khz.pcm`);

    this.rawFileStream = createWriteStream(rawFilePath);
    this.pcmFileStream = createWriteStream(pcmFilePath);
    logger.info({ rawFilePath, pcmFilePath }, 'Saving audio recordings');

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
    logger.info('Audio capture stopped');
  }
}
