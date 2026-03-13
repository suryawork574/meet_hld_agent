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

## Deploy to GCP Cloud Run

### Prerequisites

- **Google Cloud SDK (gcloud)** installed and authenticated
- **Docker** installed locally (or use Cloud Build)
- A **GCP project** with billing enabled
- **Artifact Registry** or **Container Registry** enabled

### Step 1: Set up GCP project

```bash
# Set your project ID
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1

gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com
```

### Step 2: Create Artifact Registry repository

```bash
gcloud artifacts repositories create meet-hld-agent \
  --repository-format=docker \
  --location=$REGION \
  --description="Meet HLD Agent Docker images"

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

### Step 3: Build and push the Docker image

**Option A: Build locally and push**

```bash
# Build the image
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/app:latest .

# Push to Artifact Registry
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/app:latest
```

**Option B: Build using Cloud Build (no local Docker needed)**

```bash
gcloud builds submit --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/app:latest .
```

### Step 4: Create a GCS bucket for meeting storage (optional)

```bash
export BUCKET_NAME=${PROJECT_ID}-meet-hld-data

gsutil mb -l $REGION gs://${BUCKET_NAME}
```

### Step 5: Deploy to Cloud Run

```bash
gcloud run deploy meet-hld-agent \
  --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/app:latest \
  --region $REGION \
  --platform managed \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 3600 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=your_gemini_api_key,GCS_BUCKET_NAME=${BUCKET_NAME},LOG_LEVEL=info"
```

> **Note:** For production, use **Secret Manager** instead of plain env vars for `GEMINI_API_KEY`:
>
> ```bash
> # Create secret
> echo -n "your_gemini_api_key" | gcloud secrets create gemini-api-key --data-file=-
>
> # Grant Cloud Run access
> gcloud secrets add-iam-policy-binding gemini-api-key \
>   --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
>   --role="roles/secretmanager.secretAccessor"
>
> # Deploy with secret reference
> gcloud run deploy meet-hld-agent \
>   --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/app:latest \
>   --region $REGION \
>   --platform managed \
>   --port 3000 \
>   --memory 512Mi \
>   --cpu 1 \
>   --timeout 3600 \
>   --allow-unauthenticated \
>   --set-secrets "GEMINI_API_KEY=gemini-api-key:latest" \
>   --set-env-vars "GCS_BUCKET_NAME=${BUCKET_NAME}"
> ```

### Step 6: Get the deployed URL

```bash
gcloud run services describe meet-hld-agent --region $REGION --format="value(status.url)"
```

### Step 7: Update Chrome extension WebSocket URL

After deployment, update the Chrome extension's WebSocket URL to point to your Cloud Run service instead of `localhost:3001`. Edit `chrome-extension/offscreen.js` and replace:

```js
// Change from:
const ws = new WebSocket('ws://localhost:3001');
// Change to:
const ws = new WebSocket('wss://your-cloud-run-url.run.app/ws');
```

### Continuous Deployment (optional)

Set up a Cloud Build trigger to auto-deploy on git push:

```bash
gcloud builds triggers create github \
  --repo-name=meet-hld-agent \
  --repo-owner=your-github-username \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

Create `cloudbuild.yaml`:

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${_REGION}-docker.pkg.dev/$PROJECT_ID/meet-hld-agent/app:$COMMIT_SHA', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/$PROJECT_ID/meet-hld-agent/app:$COMMIT_SHA']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'meet-hld-agent'
      - '--image'
      - '${_REGION}-docker.pkg.dev/$PROJECT_ID/meet-hld-agent/app:$COMMIT_SHA'
      - '--region'
      - '${_REGION}'
substitutions:
  _REGION: us-central1
images:
  - '${_REGION}-docker.pkg.dev/$PROJECT_ID/meet-hld-agent/app:$COMMIT_SHA'
```

## Notes

- The browser runs in **headed mode** (not headless) because audio capture requires a visible browser window
- On Linux servers without a display, use `xvfb-run npm run dev` to provide a virtual display
- Google Meet may require host approval before the bot can join — the agent waits up to 2 minutes for approval
- The bot joins with mic and camera turned off
- Diagram generation uses a two-stage approach: Gemini Live API for transcription, Gemini REST API for Mermaid generation — this produces better structured diagrams than trying to do both in the streaming session
