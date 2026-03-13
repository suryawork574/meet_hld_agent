import dotenv from 'dotenv';
dotenv.config();

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  dashboardPort: parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  audioChunkMs: parseInt(process.env.AUDIO_CHUNK_MS || '250', 10),
  designDetectDebounceMs: parseInt(process.env.DESIGN_DETECT_DEBOUNCE_MS || '15000', 10),
  diagramUpdateIntervalMs: parseInt(process.env.DIAGRAM_UPDATE_INTERVAL_MS || '30000', 10),
  gcsBucket: process.env.GCS_BUCKET_NAME || '',

  geminiLiveModel: 'models/gemini-2.5-flash-native-audio-latest',
  geminiModel: 'gemini-2.5-flash',

  get geminiWsUrl() {
    return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.geminiApiKey}`;
  },

  validate() {
    if (!this.geminiApiKey) throw new Error('GEMINI_API_KEY is required');
  }
};
