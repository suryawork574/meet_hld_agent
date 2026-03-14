import { logger } from '../utils/logger.js';

/**
 * Fuzzy voice command detection.
 *
 * Speech-to-text often mangles "agent" into "a gent", "ajan", "aged",
 * "Asian", "age and", etc. We use regex patterns that tolerate these
 * common mis-transcriptions.
 *
 * Detection strategy:
 * 1. Fuzzy-match any trigger pattern (agent / hld / diagram)
 * 2. Everything after the trigger is the instruction — no command word required
 * 3. Minimum instruction length filter to avoid false positives
 */

// Fuzzy regex patterns for the trigger word "agent" and its common
// speech-to-text mis-transcriptions. Each pattern also captures common
// prefixes like "hey", "ok", "hay", etc.
const TRIGGER_PATTERNS: { regex: RegExp; label: string }[] = [
  // "Hey Sri" — primary trigger (and common mis-hearings)
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+sri\b/i, label: 'hey sri' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+sree\b/i, label: 'hey sree' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+shri\b/i, label: 'hey shri' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+shree\b/i, label: 'hey shree' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+siri\b/i, label: 'hey siri' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+three\b/i, label: 'hey three' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+tree\b/i, label: 'hey tree' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+free\b/i, label: 'hey free' },
  { regex: /\b(?:hey|hay|he|hi|ok|okay)\s+see\b/i, label: 'hey see' },

  // "agent" and common mis-hearings (fallback triggers)
  { regex: /\b(?:hey|hay|he|ok|okay|hi|a)?\s*agent\b/i, label: 'agent' },
  { regex: /\b(?:hey|hay|he|ok|okay|hi|a)?\s*a\s*gent\b/i, label: 'a gent' },

  // "hld agent" variations
  { regex: /\bhld\s*agent\b/i, label: 'hld agent' },
  { regex: /\bh\s*l\s*d\b/i, label: 'hld' },
];

// Filler words/phrases between trigger and the actual instruction
const FILLER_PATTERN = /^[\s,;:.!?\-]*(can you|could you|please|will you|would you|i want you to|i need you to|go ahead and|try to|let's|lets|i'd like you to|i would like you to|i want to|we need to|we should|you should|just)[\s,;:.!?\-]*/gi;

// Strip leading junk repeatedly
function stripFiller(text: string): string {
  let prev = '';
  let cleaned = text.replace(/^[\s,;:.!?\-]+/, '');
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(FILLER_PATTERN, '').replace(/^[\s,;:.!?\-]+/, '');
  }
  return cleaned.trim();
}

export interface VoiceCommand {
  detected: boolean;
  triggerPhrase: string;
  instruction: string;
  rawText: string;
}

/**
 * Detects voice commands directed at the HLD agent from transcript text.
 * Uses fuzzy regex matching to find trigger phrases, then treats everything
 * after the trigger as the instruction.
 */
export function detectVoiceCommand(text: string): VoiceCommand {
  const input = text.replace(/\s+/g, ' ').trim();
  const lower = input.toLowerCase();

  // Log what we're checking so we can debug in server logs
  logger.debug({ text: lower.substring(0, 300) }, 'Voice command check');

  // Try each trigger pattern — use the one that matches latest in the text
  // (in case "agent" appears in normal conversation earlier)
  let bestMatchEnd = -1;
  let bestLabel = '';

  for (const { regex, label } of TRIGGER_PATTERNS) {
    // Find all matches, pick the last one
    let match: RegExpExecArray | null;
    const globalRegex = new RegExp(regex.source, 'gi');
    while ((match = globalRegex.exec(lower)) !== null) {
      const matchEnd = match.index + match[0].length;
      if (matchEnd > bestMatchEnd) {
        bestMatchEnd = matchEnd;
        bestLabel = label;
      }
    }
  }

  if (bestMatchEnd === -1) {
    return noMatch(text);
  }

  // Extract everything after the trigger match
  let instruction = input.substring(bestMatchEnd);
  instruction = stripFiller(instruction);

  // Need a meaningful instruction (at least a short phrase)
  if (instruction.length < 8) {
    logger.debug({ trigger: bestLabel, afterTrigger: instruction }, 'Trigger found but instruction too short');
    return noMatch(text);
  }

  logger.info({ trigger: bestLabel, instruction: instruction.substring(0, 200) }, 'Voice command detected');

  return {
    detected: true,
    triggerPhrase: bestLabel,
    instruction,
    rawText: text,
  };
}

function noMatch(text: string): VoiceCommand {
  return {
    detected: false,
    triggerPhrase: '',
    instruction: '',
    rawText: text,
  };
}

/**
 * Checks a sliding window of recent transcript text for voice commands.
 * Handles cases where trigger and instruction span multiple transcript chunks.
 */
export function detectVoiceCommandInWindow(recentTexts: string[]): VoiceCommand {
  const combined = recentTexts.join(' ');
  return detectVoiceCommand(combined);
}
