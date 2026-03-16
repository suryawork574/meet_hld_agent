# Meet HLD Agent

AI-powered tool that listens to Google Meet calls, transcribes conversations in real-time using Gemini Live API, detects system design discussions, and generates live Mermaid.js architecture diagrams on a web dashboard.

> **Want to try it out?** See the [Testing Guide](Testing.md) for a step-by-step end-to-end walkthrough.

## Architecture

```
                          Google Meet Tab (Browser)
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │  Chrome Extension (MV3)  │
                    │  ├── popup.js (config UI) │
                    │  ├── background.js        │
                    │  └── offscreen.js          │
                    │      (tabCapture + audio)  │
                    └────────────┬───────────────┘
                                 │ WebSocket (wss://)
                                 │ ?token=AUTH_TOKEN
                                 ▼
              ┌──────────────────────────────────────────────┐
              │       Cloud Run Service (Port 8080)          │
              │                                              │
              │  ┌────────────────────────────────────────┐  │
              │  │  Express + Socket.IO Server             │  │
              │  │    ├── /            Dashboard (HTTP)    │  │
              │  │    ├── /api/*       REST APIs           │  │
              │  │    ├── /socket.io   Real-time events    │  │
              │  │    └── /audio-ws    Audio WebSocket     │  │
              │  │         (persistent, survives reconnects)│  │
              │  └──────────────┬──────────────────────────┘  │
              │                 │                              │
              │                 ▼                              │
              │         ffmpeg (WebM/Opus → PCM 16kHz mono)   │
              │                 │                              │
              │                 ▼                              │
              │     Gemini Live API (WebSocket)                │
              │       ├── inputAudioTranscription              │
              │       │   (real-time speech-to-text)           │
              │       ├── outputAudioTranscription             │
              │       │   ([DESIGN] flag detection)            │
              │       └── responseModalities: AUDIO            │
              │                 │                              │
              │                 ▼                              │
              │     ┌───────────────────────────┐              │
              │     │  Analysis Pipeline         │             │
              │     │  ├── Design Detector       │             │
              │     │  │   (keyword heuristic    │             │
              │     │  │    + AI [DESIGN] flag)  │             │
              │     │  ├── Voice Command Detector│             │
              │     │  │   ("Hey Sri, ...")       │             │
              │     │  └── Transcript Buffer     │             │
              │     │      (cumulative dedup)     │             │
              │     └───────────┬───────────────┘              │
              │                 │                              │
              │      ┌──────────┴──────────┐                   │
              │      ▼ (real-time)         ▼ (on stop-capture) │
              │  Gemini REST API      Gemini REST API           │
              │  (gemini-3.1-pro)     (gemini-3.1-pro)          │
              │  └── Mermaid.js       ├── Meeting Summary       │
              │      diagram          ├── Architecture Advice   │
              │                       └── Task Breakdown        │
              │                 │                              │
              │                 ▼                              │
              │     Socket.IO → Dashboard (real-time push)     │
              │                 │                              │
              │                 ▼                              │
              │     Google Cloud Storage (persistence)         │
              └──────────────────────────────────────────────┘
                                │
                                ▼
                   User's Browser (Dashboard)
```

## Prerequisites

- **Node.js** >= 18
- **ffmpeg** installed on your system
- **Google Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)
- **Google Chrome** with the Meet HLD Agent extension loaded

### Install ffmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg
```

## Quick Start (Local Development)

1. **Install dependencies**

```bash
npm install
```

2. **Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GCS_BUCKET_NAME=your-gcs-bucket-name
AUTH_TOKEN=your-secret-token
DASHBOARD_PORT=3000
```

3. **Run the agent**

```bash
npm run dev
```

4. **Load the Chrome extension**

   - Open `chrome://extensions/` in Chrome
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `chrome-extension/` folder
   - Click the extension icon, set **Server URL** to `http://localhost:3000` and **Auth Token**

5. **Open the dashboard**

   Navigate to [http://localhost:3000](http://localhost:3000) — enter your AUTH_TOKEN when prompted.

6. **Start capturing** — Join a Google Meet, click the extension icon, and hit **Start Capture**

---

## Deploy to Google Cloud Run

```bash
# One-command deploy from source
gcloud run deploy meet-hld-agent \
  --source . \
  --region=asia-south1 \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=your-key,GCS_BUCKET_NAME=your-bucket,AUTH_TOKEN=$(openssl rand -hex 16)"
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | (required) | Google Gemini API key |
| `AUTH_TOKEN` | (optional) | Shared secret for WebSocket + dashboard auth |
| `GCS_BUCKET_NAME` | (optional) | GCS bucket for saving meeting data |
| `DASHBOARD_PORT` | `3000` | Dashboard port (local dev) |
| `PORT` | `8080` | Server port (set by Cloud Run) |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `AUDIO_CHUNK_MS` | `250` | Audio chunk duration in ms |
| `DESIGN_DETECT_DEBOUNCE_MS` | `15000` | Min interval between diagram generations |
| `DIAGRAM_UPDATE_INTERVAL_MS` | `30000` | Diagram update interval |

## AI Models Used

| Model | Purpose | API |
|-------|---------|-----|
| `gemini-2.5-flash-native-audio-latest` | Real-time audio transcription + design detection | Gemini Live API (WebSocket) |
| `gemini-3.1-pro-preview` | Mermaid diagram, summary, advice, tasks generation | Gemini REST API |

## Key Features

| Feature | Description |
|---------|-------------|
| Real-time Transcription | Live speech-to-text via Gemini Live API with cumulative deduplication |
| Auto Design Detection | Keyword heuristic + AI [DESIGN] flag detection |
| Live Mermaid.js Diagrams | Auto-generated and styled architecture diagrams with zoom controls |
| Voice Commands | Say *"Hey Sri, add a cache layer"* — diagram updates live |
| Deferred Content Generation | Summary, advice, and tasks generated on stop-capture (not real-time) for performance |
| Meeting Persistence | Save/load meeting data to/from Google Cloud Storage |
| Dashboard Auth | Cookie-based session auth with login page (AUTH_TOKEN) |
| WebSocket Auth | Token validated on WebSocket upgrade via `?token=` query param |
| Persistent WebSocket Server | `/audio-ws` stays alive across extension reconnections |
| Clear All | Single button to reset diagram, transcript, summary, suggestions, and tasks |
| Cloud Deployment | Dockerized on GCP Cloud Run — direct WebSocket, no proxy needed |

## Project Structure

```
src/
├── index.ts                        # Main orchestrator
├── config/index.ts                 # Environment config + model settings
├── meet/
│   └── audio-capture.ts            # Persistent WSS → ffmpeg → PCM chunks
├── gemini/
│   ├── client.ts                   # Gemini Live API client (cumulative transcript dedup)
│   ├── messages.ts                 # Setup + audio chunk message builders
│   └── types.ts                    # TypeScript interfaces
├── analysis/
│   ├── transcript-buffer.ts        # Sliding window transcript store with clear()
│   ├── design-detector.ts          # Keyword-based design detection
│   ├── voice-command-detector.ts   # "Hey Sri" voice command recognition
│   └── diagram-generator.ts        # Mermaid diagram + summary + advice + tasks
├── dashboard/
│   ├── server.ts                   # Express + Socket.IO + auth middleware + clear:all
│   └── public/                     # Dashboard frontend (HTML/CSS/JS)
├── storage/
│   └── gcs.ts                      # Google Cloud Storage integration
└── utils/
    └── logger.ts                   # Structured logging (pino)

chrome-extension/                   # Chrome Extension (Manifest V3)
├── manifest.json
├── background.js                   # Reads config from chrome.storage.sync
├── popup.js & popup.html           # Config UI (Server URL + Auth Token)
├── offscreen.js & offscreen.html   # Audio capture + WebSocket streaming
```

## Voice Commands

Say **"Hey Sri"** (or variants: Sree, Shri, Siri) followed by an instruction during the meeting:

| Voice Command | Action |
|--------------|--------|
| *"Hey Sri, add a Redis cache between the API and database"* | Adds cache layer to diagram |
| *"Hey Sri, replace Kafka with RabbitMQ"* | Swaps message broker component |
| *"Hey Sri, add a reporting service with OLAP database"* | Adds new service + database nodes |
| *"Hey Sri, show async communication between order and notification"* | Updates arrows to dashed async |

- 10-second cooldown between commands
- Minimum instruction length required (>10 chars)
- Fallback triggers: "Hey Agent", "Hey HLD"

## Troubleshooting

### Extension shows "Cannot connect"
- Ensure the server is running (locally or on Cloud Run)
- Check Server URL and Auth Token in extension popup settings
- Verify AUTH_TOKEN matches between extension and server

### No transcription appearing
- Check Cloud Run logs: `gcloud run services logs read meet-hld-agent --region=asia-south1 --limit=50`
- Look for "Gemini Live API session ready" — if missing, check GEMINI_API_KEY
- Look for "Input transcription received" messages in logs

### Dashboard shows stale data after refresh
- Data is now preserved on refresh — server sends current state to new connections
- Use the **Clear** button to reset all data (diagram, transcript, summary, suggestions, tasks)

### Diagram too zoomed in
- Initial zoom is set to 60% — use +/- buttons or Ctrl+scroll to adjust
- Click "Fit" to auto-fit diagram to container

### Cold start delay
- First request after inactivity may take 3-5 seconds
- Use `--min-instances=1` during active use to avoid cold starts (adds cost)
