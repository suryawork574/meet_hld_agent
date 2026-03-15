# Deployment Guide — Google Cloud Run

This guide covers deploying the Meet HLD Agent to Google Cloud Run with app-level token authentication.

## Architecture Overview

```
Chrome Extension ──► wss://meet-hld-agent-XXX.REGION.run.app/audio-ws?token=AUTH_TOKEN
                              │
                              ▼ (direct HTTPS + WebSocket — no proxy needed)
                    ┌─────────────────────────────┐
                    │  Cloud Run Service           │
                    │  (asia-south1 region)         │
                    │                              │
                    │  Single Port 8080            │
                    │  ├── /           Dashboard   │  ◄── Cookie auth (AUTH_TOKEN login)
                    │  ├── /api/*      REST APIs   │  ◄── Cookie auth
                    │  ├── /socket.io  Socket.IO   │  ◄── Cookie/token auth
                    │  └── /audio-ws   Audio WS    │  ◄── ?token= query param auth
                    │                              │
                    │  Persistent WebSocket Server │
                    │  (survives reconnections)    │
                    └──────────┬───────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
           Gemini Live API        Google Cloud Storage
           (transcription)        (meeting persistence)
```

## Why `--allow-unauthenticated`?

Browser WebSockets **cannot send IAM auth headers** on the upgrade request. Cloud Run's built-in IAM auth would block all WebSocket connections from the Chrome extension. Instead, we use:

- **App-level AUTH_TOKEN** — validated on WebSocket upgrade via `?token=` query param
- **Cookie-based session auth** — dashboard shows a login page; valid token sets an HTTP-only session cookie

---

## Prerequisites

- Google Cloud SDK (`gcloud`) installed and authenticated
- A GCP project with billing enabled

---

## Quick Deploy (From Source)

The simplest way to deploy — Cloud Build handles the Docker build:

```bash
# Set variables
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-south1"
export AUTH_TOKEN=$(openssl rand -hex 16)

echo "Save this AUTH_TOKEN for the Chrome extension: $AUTH_TOKEN"

gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

# Deploy from source
gcloud run deploy meet-hld-agent \
  --source . \
  --region=$REGION \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=your-gemini-api-key,GCS_BUCKET_NAME=your-gcs-bucket,AUTH_TOKEN=$AUTH_TOKEN"
```

---

## Detailed Deployment Steps

### Step 1 — Set Environment Variables

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-south1"
export SERVICE_NAME="meet-hld-agent"

gcloud config set project $PROJECT_ID
```

### Step 2 — Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

### Step 3 — Generate Auth Token

```bash
export AUTH_TOKEN=$(openssl rand -hex 16)
echo "AUTH_TOKEN: $AUTH_TOKEN"
echo "Save this — you'll need it for the Chrome extension settings"
```

### Step 4 — Deploy

```bash
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region=$REGION \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=your-gemini-api-key,GCS_BUCKET_NAME=your-gcs-bucket,AUTH_TOKEN=$AUTH_TOKEN"
```

### Step 5 — Verify

```bash
# Get service URL
gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)"

# Check logs
gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=30
```

Open the service URL in your browser — you should see the login page. Enter your AUTH_TOKEN to access the dashboard.

---

## Configure Chrome Extension

1. Open the extension popup (click the Meet HLD Agent icon)
2. Set **Server URL** to your Cloud Run URL:
   ```
   https://meet-hld-agent-XXXXXXXXXX.asia-south1.run.app
   ```
3. Set **Auth Token** to the same `AUTH_TOKEN` value from deployment
4. The extension automatically converts to `wss://` and appends `?token=` for WebSocket

> No `gcloud proxy` needed — the extension connects directly to Cloud Run.

---

## Updating the Application

```bash
# Redeploy from source (rebuilds automatically)
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region=$REGION \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=your-key,GCS_BUCKET_NAME=your-bucket,AUTH_TOKEN=your-token"
```

---

## Cloud Run Configuration Reference

| Setting | Value | Reason |
|---------|-------|--------|
| Port | 8080 | Cloud Run default (set automatically) |
| Memory | 1Gi | ffmpeg + Node.js processing |
| CPU | 1 vCPU | Audio processing workload |
| Timeout | 300s (default) | Cloud Run manages WebSocket keep-alive |
| Min instances | 0 | Scale to zero when idle (cost savings) |
| Max instances | 3 | Handle concurrent sessions |
| Session affinity | Recommended | WebSocket + Socket.IO sticky sessions |
| Ingress | All | Chrome extension connects directly |
| Auth | `--allow-unauthenticated` | App-level AUTH_TOKEN handles auth instead |

### Optional: Increase timeout and session affinity

```bash
gcloud run services update $SERVICE_NAME \
  --region=$REGION \
  --timeout=3600 \
  --session-affinity \
  --min-instances=1
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `AUTH_TOKEN` | Recommended | — | Shared secret for WebSocket + dashboard auth |
| `GCS_BUCKET_NAME` | No | — | GCS bucket for saving meeting data |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |
| `AUDIO_CHUNK_MS` | No | `250` | Audio chunk duration in ms |
| `DESIGN_DETECT_DEBOUNCE_MS` | No | `15000` | Min interval between diagram generations |
| `DIAGRAM_UPDATE_INTERVAL_MS` | No | `30000` | Diagram update interval |

> `PORT` is automatically set by Cloud Run — do not override it.

---

## Authentication Flow

```
┌─────────────────────────────────────────────────────────┐
│ WebSocket (Chrome Extension)                            │
│   Extension sends: wss://...?token=AUTH_TOKEN            │
│   Server validates token on upgrade → accept or reject  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Dashboard (Browser)                                     │
│   1. User visits Cloud Run URL                          │
│   2. Server shows login page (no cookie yet)            │
│   3. User enters AUTH_TOKEN                             │
│   4. Server validates → sets HTTP-only session cookie   │
│   5. All subsequent requests authenticated via cookie   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Socket.IO                                               │
│   Authenticated via session cookie or handshake token   │
└─────────────────────────────────────────────────────────┘
```

---

## Cost Estimate

| Resource | Estimated Cost |
|----------|---------------|
| Cloud Run (0 min instances, scale to zero) | ~$0 idle, ~$5-15/month active |
| Google Cloud Storage | ~$0.02/GB/month |
| Gemini API | Pay per token (see Google AI pricing) |
| SSL Certificate | Free (Google-managed on Cloud Run URL) |
| Cloud Build | 120 min/day free tier |
| **Total infrastructure** | **~$5-15/month** (excluding Gemini API) |

---

## Troubleshooting

### Extension shows "Cannot connect"
- Verify Cloud Run service is running: `gcloud run services describe meet-hld-agent --region=asia-south1`
- Check Server URL in extension matches the Cloud Run URL exactly
- Ensure AUTH_TOKEN matches between extension and Cloud Run env vars
- Check logs: `gcloud run services logs read meet-hld-agent --region=asia-south1 --limit=50`

### WebSocket returns 503
- The service may be starting up (cold start) — wait a few seconds and retry
- Check if Gemini connection is failing (look for repeated reconnection attempts in logs)
- The persistent WSS should survive reconnections — if not, redeploy

### No transcription in dashboard
- Look for "Gemini Live API session ready" in logs — if missing, check GEMINI_API_KEY
- Look for "Input transcription received" — if missing, audio may not be reaching Gemini
- Verify ffmpeg is installed in the Docker image (it's included in the Dockerfile)

### Dashboard login not working
- Ensure AUTH_TOKEN is set in Cloud Run environment variables
- Clear browser cookies and try again
- If AUTH_TOKEN is empty, all routes are accessible without login
