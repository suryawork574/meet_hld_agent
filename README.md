# Meet HLD Agent

AI agent that listens to a Google Meet call, transcribes the conversation in real-time using Gemini Live API, detects system design discussions, and generates live Mermaid.js diagrams on a web dashboard.

## Architecture

```
Chrome Extension (Tab Audio Capture)
       │
       ▼ WebSocket (/audio-ws)
Express + Socket.IO Server (single port)
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
 Gemini REST API ──► Mermaid.js diagram + Summary + Advice + Tasks
       │
       ▼
 Socket.IO Dashboard ──► Live diagram + transcript
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

5. **Open the dashboard**

   Navigate to [http://localhost:3000](http://localhost:3000)

6. **Start capturing** — Join a Google Meet, click the extension icon, and hit **Start Capture**

---

## Deploy to Google Cloud Run

The app is deployed to Cloud Run with **IAM-based authentication** — only authorized Google accounts can access it.

### Prerequisites

- **Google Cloud SDK** (`gcloud`) installed and authenticated
- A **GCP project** with billing enabled

### Step 1: Set environment variables

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-south1"
export SERVICE_NAME="meet-hld-agent"

gcloud config set project $PROJECT_ID
```

### Step 2: Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

### Step 3: Create Artifact Registry repository

```bash
gcloud artifacts repositories create meet-hld-agent \
  --repository-format=docker \
  --location=$REGION \
  --description="Meet HLD Agent Docker images"

gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

### Step 4: Build and push Docker image

```bash
gcloud builds submit . \
  --tag=${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest \
  --region=$REGION \
  --default-buckets-behavior=regional-user-owned-bucket
```

### Step 5: Deploy to Cloud Run

```bash
gcloud run deploy $SERVICE_NAME \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest \
  --region=$REGION \
  --platform=managed \
  --port=8080 \
  --timeout=3600 \
  --min-instances=0 \
  --max-instances=3 \
  --memory=1Gi \
  --cpu=1 \
  --session-affinity \
  --no-allow-unauthenticated \
  --ingress=all \
  --set-env-vars="GEMINI_API_KEY=your-key,GCS_BUCKET_NAME=your-bucket"
```

### Step 6: Grant access to users

```bash
# Grant yourself access
gcloud run services add-iam-policy-binding $SERVICE_NAME \
  --region=$REGION \
  --member="user:your-email@gmail.com" \
  --role="roles/run.invoker"

# Grant access to other users
gcloud run services add-iam-policy-binding $SERVICE_NAME \
  --region=$REGION \
  --member="user:colleague@gmail.com" \
  --role="roles/run.invoker"
```

### Step 7: Verify deployment

```bash
# Check service status
gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)"

# Test with auth token
TOKEN=$(gcloud auth print-identity-token)
curl -H "Authorization: Bearer $TOKEN" "$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')/api/status"
```

---

## Running the App (Cloud Run)

### Step 1: Start the Cloud Run proxy

The proxy runs locally and handles authentication using your `gcloud` credentials:

```bash
gcloud run services proxy meet-hld-agent --region=asia-south1 --port=8080
```

This creates an authenticated tunnel: `localhost:8080` → Cloud Run.

### Step 2: Open the dashboard

Navigate to [http://localhost:8080](http://localhost:8080) in your browser.

### Step 3: Start capturing audio

1. Join a Google Meet call in Chrome
2. Click the **Meet HLD Agent** extension icon
3. Click **Start Capture**
4. The extension sends audio to `ws://localhost:8080/audio-ws` → proxy → Cloud Run

### How it works

```
Chrome Extension
       │
       ▼ ws://localhost:8080/audio-ws
 gcloud proxy (adds auth automatically)
       │
       ▼ wss:// (authenticated)
 Cloud Run Service
       ├── Dashboard (HTTP + Socket.IO)
       ├── Audio WebSocket (/audio-ws)
       └── REST APIs (/api/*)
```

---

## Updating the Deployment

```bash
# Build and push new image
gcloud builds submit . \
  --tag=${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest \
  --region=$REGION \
  --default-buckets-behavior=regional-user-owned-bucket

# Deploy new revision
gcloud run deploy $SERVICE_NAME \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest \
  --region=$REGION
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | (required) | Google Gemini API key |
| `GCS_BUCKET_NAME` | (optional) | GCS bucket for saving meeting data |
| `DASHBOARD_PORT` | `3000` | Dashboard port (local dev) |
| `PORT` | `8080` | Server port (set by Cloud Run) |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `AUDIO_CHUNK_MS` | `250` | Audio chunk duration in ms |
| `DESIGN_DETECT_DEBOUNCE_MS` | `15000` | Min interval between diagram generations |
| `DIAGRAM_UPDATE_INTERVAL_MS` | `30000` | Diagram update interval |

## Project Structure

```
src/
├── index.ts                        # Main orchestrator
├── config/index.ts                 # Environment variable loading
├── meet/
│   └── audio-capture.ts            # WebSocket audio → ffmpeg → PCM chunks
├── gemini/
│   ├── client.ts                   # Gemini Live API WebSocket client
│   ├── messages.ts                 # Message builders
│   └── types.ts                    # TypeScript interfaces
├── analysis/
│   ├── transcript-buffer.ts        # Sliding window transcript store
│   ├── design-detector.ts          # Keyword-based design detection
│   ├── voice-command-detector.ts   # Voice command recognition
│   └── diagram-generator.ts        # Mermaid diagram + summary + advice + tasks
├── dashboard/
│   ├── server.ts                   # Express + Socket.IO server
│   └── public/                     # Dashboard frontend (HTML/CSS/JS)
├── storage/
│   └── gcs.ts                      # Google Cloud Storage integration
└── utils/
    └── logger.ts                   # Structured logging (pino)

chrome-extension/                   # Chrome extension (Manifest V3)
├── manifest.json
├── background.js
├── popup.js & popup.html
├── offscreen.js & offscreen.html   # Audio capture via MediaRecorder
```

## Troubleshooting

### Cloud Run proxy won't start
```bash
# Make sure you're authenticated
gcloud auth login
gcloud auth application-default login
```

### WebSocket connection fails
- Ensure the proxy is running: `gcloud run services proxy meet-hld-agent --region=asia-south1 --port=8080`
- Check that port 8080 isn't in use by another process

### Extension shows "Cannot connect"
- Start the Cloud Run proxy first, then try the extension
- Check the proxy terminal for errors

### 403 Forbidden
- Your account needs `roles/run.invoker` on the Cloud Run service
- Run the grant command from Step 6 above

### Cold start delay
- First request after inactivity may take 3-5 seconds
- Use `--min-instances=1` during active use to avoid cold starts (adds cost)
