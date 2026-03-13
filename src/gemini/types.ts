export interface GeminiSetupMessage {
  setup: {
    model: string;
    generationConfig: {
      responseModalities: string[];
      speechConfig?: { languageCode?: string };
    };
    inputAudioTranscription?: {};
    outputAudioTranscription?: {};
    systemInstruction?: {
      parts: { text: string }[];
    };
  };
}

export interface GeminiRealtimeInput {
  realtimeInput: {
    mediaChunks: {
      mimeType: string;
      data: string; // base64 encoded PCM
    }[];
  };
}

export interface GeminiClientTextInput {
  clientContent: {
    turns: {
      role: string;
      parts: { text: string }[];
    }[];
    turnComplete: boolean;
  };
}

export interface GeminiServerContent {
  serverContent?: {
    modelTurn?: {
      parts: { text?: string }[];
    };
    inputTranscription?: {
      parts: { text?: string }[];
      role?: string;
    };
    outputTranscription?: {
      parts: { text?: string }[];
      role?: string;
    };
    turnComplete?: boolean;
  };
  setupComplete?: {};
  toolCall?: any;
}

export type GeminiMessage = GeminiSetupMessage | GeminiRealtimeInput | GeminiClientTextInput;
