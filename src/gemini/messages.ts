import { config } from '../config/index.js';
import type { GeminiSetupMessage, GeminiRealtimeInput, GeminiClientTextInput } from './types.js';

export function buildSetupMessage(): GeminiSetupMessage {
  return {
    setup: {
      model: config.geminiLiveModel,
      generationConfig: {
        responseModalities: ['AUDIO'],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: {
        parts: [{
          text: `You are a silent meeting observer. Do NOT transcribe, summarize, or repeat what the speaker says.
Your only job: if the conversation is about system design, architecture, databases, APIs, microservices, or any technical design topic, say "[DESIGN]". Otherwise say nothing.`,
        }],
      },
    },
  };
}

export function buildAudioChunkMessage(base64AudioData: string): GeminiRealtimeInput {
  return {
    realtimeInput: {
      mediaChunks: [{
        mimeType: 'audio/pcm;rate=16000',
        data: base64AudioData,
      }],
    },
  };
}

export function buildTextMessage(text: string): GeminiClientTextInput {
  return {
    clientContent: {
      turns: [{
        role: 'user',
        parts: [{ text }],
      }],
      turnComplete: true,
    },
  };
}
