export interface TranscriptEntry {
  text: string;
  timestamp: number;
  isDesign: boolean;
}

export class TranscriptBuffer {
  private entries: TranscriptEntry[] = [];
  private maxAgeMs: number;

  constructor(maxAgeMs = 5 * 60 * 1000) { // Keep last 5 minutes
    this.maxAgeMs = maxAgeMs;
  }

  add(text: string, isDesign: boolean) {
    const now = Date.now();
    this.entries.push({ text, timestamp: now, isDesign });
    this.prune(now);
  }

  private prune(now: number) {
    const cutoff = now - this.maxAgeMs;
    this.entries = this.entries.filter(e => e.timestamp > cutoff);
  }

  getRecentText(durationMs?: number): string {
    const now = Date.now();
    const cutoff = now - (durationMs || this.maxAgeMs);
    return this.entries
      .filter(e => e.timestamp > cutoff)
      .map(e => e.text)
      .join(' ');
  }

  getRecentDesignText(durationMs = 60000): string {
    const now = Date.now();
    const cutoff = now - durationMs;
    return this.entries
      .filter(e => e.timestamp > cutoff && e.isDesign)
      .map(e => e.text)
      .join(' ');
  }

  hasRecentDesignContent(durationMs = 30000): boolean {
    const now = Date.now();
    const cutoff = now - durationMs;
    return this.entries.some(e => e.timestamp > cutoff && e.isDesign);
  }

  getAll(): TranscriptEntry[] {
    return [...this.entries];
  }

  getFullTranscript(): string {
    return this.entries.map(e => e.text).join(' ');
  }
}
