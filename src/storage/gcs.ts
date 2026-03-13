import { Storage } from '@google-cloud/storage';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface MeetingData {
  meetingId: string;
  date: string; // YYYY-MM-DD
  transcript: { text: string; timestamp: number; isDesign: boolean }[];
  summary: string;
  diagram: string;
  advice: string;
  tasks?: string;
  savedAt: string;
}

const storage = new Storage();

function getBucket() {
  return storage.bucket(config.gcsBucket);
}

function getMeetingPath(meetingId: string, date: string): string {
  return `meetings/${date}/${meetingId}.json`;
}

export async function saveMeetingToGCS(data: MeetingData): Promise<void> {
  const filePath = getMeetingPath(data.meetingId, data.date);
  const bucket = getBucket();
  const file = bucket.file(filePath);

  const json = JSON.stringify(data, null, 2);
  await file.save(json, { contentType: 'application/json' });

  logger.info({ meetingId: data.meetingId, date: data.date, path: filePath }, 'Meeting data saved to GCS');
}

export async function loadMeetingFromGCS(meetingId: string, date: string): Promise<MeetingData | null> {
  const filePath = getMeetingPath(meetingId, date);
  const bucket = getBucket();
  const file = bucket.file(filePath);

  try {
    const [exists] = await file.exists();
    if (!exists) {
      logger.warn({ meetingId, date }, 'Meeting not found in GCS');
      return null;
    }

    const [content] = await file.download();
    const data: MeetingData = JSON.parse(content.toString());
    logger.info({ meetingId, date }, 'Meeting data loaded from GCS');
    return data;
  } catch (err) {
    logger.error({ err, meetingId, date }, 'Failed to load meeting from GCS');
    return null;
  }
}

export async function listMeetingsFromGCS(): Promise<{ meetingId: string; date: string; savedAt: string }[]> {
  const bucket = getBucket();

  try {
    const [files] = await bucket.getFiles({ prefix: 'meetings/' });
    const meetings: { meetingId: string; date: string; savedAt: string }[] = [];

    for (const file of files) {
      // Path: meetings/YYYY-MM-DD/meetingId.json
      const parts = file.name.split('/');
      if (parts.length === 3 && parts[2].endsWith('.json')) {
        const date = parts[1];
        const meetingId = parts[2].replace('.json', '');

        // Download metadata from the file to get savedAt
        try {
          const [content] = await file.download();
          const data = JSON.parse(content.toString());
          meetings.push({ meetingId, date, savedAt: data.savedAt || '' });
        } catch {
          meetings.push({ meetingId, date, savedAt: '' });
        }
      }
    }

    // Sort by date descending
    meetings.sort((a, b) => b.date.localeCompare(a.date) || b.savedAt.localeCompare(a.savedAt));
    return meetings;
  } catch (err) {
    logger.error({ err }, 'Failed to list meetings from GCS');
    return [];
  }
}
