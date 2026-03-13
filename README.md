# Meet HLD Agent

AI agent that joins a Google Meet call, transcribes the conversation in real-time using Gemini Live API, detects system design discussions, and generates live Mermaid.js diagrams on a web dashboard.

## Architecture

```
Google Meet (Chrome/Puppeteer)
       │
       ▼
 puppeteer-stream (WebM/Opus)
       │
       ▼
 ffmpeg (PCM 16kHz 16-bit mono)
       │
       ▼
 Gemini Live API (WebSocket) ──► Real-time transcription
       │
       ▼
 Design Detector (keyword heuristic + [DESIGN] flag)
       │
       ▼
 Gemini REST API ──► Mermaid.js diagram generation
       │
       ▼
 Express + Socket.IO Dashboard ──► Live diagram + transcript
```

## Project Structure

```
src/
├── index.ts                        # Main orchestrator
├── meet/
│   ├── browser.ts                  # Puppeteer + stealth plugin launch
│   ├── join.ts                     # Google Meet join automation
│   └── audio-capture.ts           # Tab audio → ffmpeg → PCM chunks
├── gemini/
│   ├── client.ts                   # WebSocket client for Gemini Live API
│   ├── messages.ts                 # Message builders (setup, audio, text)
│   └── types.ts                    # TypeScript interfaces
├── analysis/
│   ├── transcript-buffer.ts        # Sliding window transcript store
│   ├── design-detector.ts          # Keyword-based design discussion detection
│   └── diagram-generator.ts        # Transcript → Mermaid.js via Gemini REST API
├── dashboard/
│   ├── server.ts                   # Express + Socket.IO server
│   └── public/
│       ├── index.html              # Dashboard SPA
│       ├── app.js                  # Socket.IO client + Mermaid rendering
│       └── styles.css              # Dark theme styling
├── config/
│   └── index.ts                    # Environment variable loading
└── utils/
    └── logger.ts                   # Structured logging (pino)

chrome-extension/                   # MV3 extension for tab audio capture
├── manifest.json
├── background.js
└── content.js
```

## Prerequisites

- **Node.js** >= 18
- **ffmpeg** installed on your system
- **Google Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)
- **Google Chrome** (Puppeteer will manage it)

### Install ffmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Windows (via chocolatey)
choco install ffmpeg
```

## Setup

1. **Clone and install dependencies**

```bash
cd genai_meet_diagram
npm install
```

2. **Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_MEET_URL=https://meet.google.com/xxx-yyyy-zzz
GUEST_NAME=AI Diagram Bot
DASHBOARD_PORT=3000
```

3. **Run the agent**

```bash
npm run dev
```

4. **Open the dashboard**

Navigate to [http://localhost:3000](http://localhost:3000) in your browser to see:
- Live transcript (left panel)
- Real-time Mermaid.js diagram (right panel)
- Connection status indicators

## How It Works

1. **Puppeteer** launches Chrome with `puppeteer-extra-plugin-stealth` and joins the specified Google Meet as a guest
2. **puppeteer-stream** captures tab audio in WebM/Opus format
3. **ffmpeg** transcodes the audio stream to raw PCM (16kHz, 16-bit, mono) in real-time
4. PCM audio is chunked into 250ms segments, base64-encoded, and streamed via **WebSocket to Gemini Live API**
5. Gemini transcribes the audio and flags system design content with a `[DESIGN]` prefix
6. A local **keyword detector** also scans for design-related terms (architecture, microservice, database, API, etc.)
7. When design discussion is detected (debounced to every 15s), the last 2 minutes of transcript are sent to the **Gemini REST API** to generate a **Mermaid.js** diagram
8. The diagram and transcript are pushed to the browser dashboard via **Socket.IO** for live rendering

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | (required) | Google Gemini API key |
| `GOOGLE_MEET_URL` | (required) | Google Meet URL to join |
| `GUEST_NAME` | `AI Diagram Bot` | Name shown in Meet |
| `DASHBOARD_PORT` | `3000` | Dashboard server port |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `AUDIO_CHUNK_MS` | `250` | Audio chunk duration in ms |
| `DESIGN_DETECT_DEBOUNCE_MS` | `15000` | Min interval between diagram generations |
| `DIAGRAM_UPDATE_INTERVAL_MS` | `30000` | Diagram update interval |

## Notes

- The browser runs in **headed mode** (not headless) because audio capture requires a visible browser window
- On Linux servers without a display, use `xvfb-run npm run dev` to provide a virtual display
- Google Meet may require host approval before the bot can join — the agent waits up to 2 minutes for approval
- The bot joins with mic and camera turned off
- Diagram generation uses a two-stage approach: Gemini Live API for transcription, Gemini REST API for Mermaid generation — this produces better structured diagrams than trying to do both in the streaming session
