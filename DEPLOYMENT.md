# Deployment Guide — Google Cloud Run with IAP

This guide covers deploying the Meet HLD Agent to Google Cloud Run with Identity-Aware Proxy (IAP) for authentication.

## Architecture Overview

```
User (Browser)
    │
    ▼
[ Global HTTPS Load Balancer ]  ◄── IAP enabled here
    │
    ▼
[ Serverless NEG ]
    │
    ▼
[ Cloud Run Service ]  (port 8080)
    ├── /              → Dashboard (HTTP)
    ├── /api/*         → REST APIs
    ├── /socket.io     → Socket.IO (real-time updates)
    └── /audio-ws      → Audio WebSocket (Chrome extension)
```

> **Why a Load Balancer?** IAP only works with Google Cloud Load Balancers. Cloud Run alone does not support IAP directly.

---

## Prerequisites

- Google Cloud SDK (`gcloud`) installed and authenticated
- A GCP project with billing enabled
- Docker installed locally (for testing)
- A domain name (required for IAP + HTTPS)

---

## Step 1 — Set Environment Variables

Set these once for all subsequent commands:

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export SERVICE_NAME="meet-hld-agent"
export DOMAIN="your-app.example.com"

gcloud config set project $PROJECT_ID
```

---

## Step 2 — Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  containerregistry.googleapis.com \
  artifactregistry.googleapis.com \
  compute.googleapis.com \
  iap.googleapis.com \
  certificatemanager.googleapis.com
```

---

## Step 3 — Create Artifact Registry Repository

```bash
gcloud artifacts repositories create meet-hld-agent \
  --repository-format=docker \
  --location=$REGION \
  --description="Meet HLD Agent Docker images"
```

Configure Docker to authenticate with Artifact Registry:

```bash
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

---

## Step 4 — Build and Push Docker Image

```bash
# Build the image
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest .

# Push to Artifact Registry
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest
```

---

## Step 5 — Create a Service Account

Create a dedicated service account for the Cloud Run service:

```bash
gcloud iam service-accounts create meet-hld-sa \
  --display-name="Meet HLD Agent Service Account"

# Grant GCS access (for meeting storage)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:meet-hld-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

---

## Step 6 — Deploy to Cloud Run

Generate an auth token for the WebSocket endpoint:

```bash
export AUTH_TOKEN=$(openssl rand -hex 16)
echo "Save this token for the Chrome extension: $AUTH_TOKEN"
```

Deploy:

```bash
gcloud run deploy $SERVICE_NAME \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest \
  --region=$REGION \
  --platform=managed \
  --service-account=meet-hld-sa@${PROJECT_ID}.iam.gserviceaccount.com \
  --set-env-vars="GEMINI_API_KEY=your-gemini-api-key,GCS_BUCKET_NAME=your-gcs-bucket,AUTH_TOKEN=$AUTH_TOKEN" \
  --port=8080 \
  --timeout=3600 \
  --min-instances=1 \
  --max-instances=3 \
  --memory=1Gi \
  --cpu=1 \
  --session-affinity \
  --allow-unauthenticated
```

Key flags explained:
| Flag | Why |
|------|-----|
| `--timeout=3600` | WebSocket connections need long timeouts (max 1 hour) |
| `--min-instances=1` | Avoid cold starts for real-time audio processing |
| `--session-affinity` | Required for Socket.IO and WebSocket sticky sessions |
| `--allow-unauthenticated` | Required because browser WebSockets cannot send IAM auth headers. App-level `AUTH_TOKEN` secures the WebSocket endpoint instead |
| `AUTH_TOKEN` | Shared secret validated on WebSocket upgrade — the Chrome extension sends it as a `?token=` query parameter |

---

## Step 7 — Reserve a Static IP

```bash
gcloud compute addresses create meet-hld-ip \
  --global \
  --ip-version=IPV4

# Note the IP address — point your domain DNS to this
gcloud compute addresses describe meet-hld-ip --global --format="get(address)"
```

**Update your DNS**: Create an `A` record for `$DOMAIN` pointing to this IP address.

---

## Step 8 — Create SSL Certificate

```bash
gcloud compute ssl-certificates create meet-hld-cert \
  --domains=$DOMAIN \
  --global
```

> Google-managed certificates auto-provision once DNS is pointed correctly. This can take 15–30 minutes.

---

## Step 9 — Create Serverless NEG (Network Endpoint Group)

```bash
gcloud compute network-endpoint-groups create meet-hld-neg \
  --region=$REGION \
  --network-endpoint-type=serverless \
  --cloud-run-service=$SERVICE_NAME
```

---

## Step 10 — Create Backend Service

```bash
# Create the backend service
gcloud compute backend-services create meet-hld-backend \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --protocol=HTTPS \
  --timeout-sec=3600 \
  --connection-draining-timeout=300

# Add the NEG as a backend
gcloud compute backend-services add-backend meet-hld-backend \
  --global \
  --network-endpoint-group=meet-hld-neg \
  --network-endpoint-group-region=$REGION
```

> `--timeout-sec=3600` matches the Cloud Run timeout for WebSocket support.

---

## Step 11 — Create URL Map and HTTPS Proxy

```bash
# URL map (routes all traffic to the backend)
gcloud compute url-maps create meet-hld-urlmap \
  --default-service=meet-hld-backend \
  --global

# HTTPS target proxy
gcloud compute target-https-proxies create meet-hld-https-proxy \
  --ssl-certificates=meet-hld-cert \
  --url-map=meet-hld-urlmap \
  --global

# Forwarding rule (binds the static IP to the proxy)
gcloud compute forwarding-rules create meet-hld-forwarding-rule \
  --global \
  --target-https-proxy=meet-hld-https-proxy \
  --address=meet-hld-ip \
  --ports=443 \
  --load-balancing-scheme=EXTERNAL_MANAGED
```

---

## Step 12 — Enable IAP on the Backend Service

### 12a. Create OAuth Consent Screen

1. Go to [GCP Console → APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Choose **Internal** (for organization users only) or **External**
3. Fill in App name, support email, and authorized domains
4. Save

### 12b. Create OAuth Client ID

1. Go to [GCP Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Meet HLD Agent IAP`
5. Authorized redirect URIs: `https://iap.googleapis.com/v1/oauth/clientIds/CLIENT_ID:handleRedirect`
   (replace `CLIENT_ID` after creation — you'll need to update this)
6. Note the **Client ID** and **Client Secret**

### 12c. Enable IAP

```bash
gcloud iap web enable \
  --resource-type=backend-services \
  --service=meet-hld-backend \
  --oauth2-client-id=YOUR_CLIENT_ID \
  --oauth2-client-secret=YOUR_CLIENT_SECRET
```

### 12d. Grant Access to Users

```bash
# Grant access to specific users
gcloud iap web add-iam-policy-binding \
  --resource-type=backend-services \
  --service=meet-hld-backend \
  --member="user:user@example.com" \
  --role="roles/iap.httpsResourceAccessor"

# Or grant access to an entire Google group
gcloud iap web add-iam-policy-binding \
  --resource-type=backend-services \
  --service=meet-hld-backend \
  --member="group:team@example.com" \
  --role="roles/iap.httpsResourceAccessor"

# Or grant access to entire domain
gcloud iap web add-iam-policy-binding \
  --resource-type=backend-services \
  --service=meet-hld-backend \
  --member="domain:example.com" \
  --role="roles/iap.httpsResourceAccessor"
```

---

## Step 13 — Configure Chrome Extension

The Chrome extension has a configurable **Server URL** and **Auth Token** in its popup UI.

1. Open the extension popup
2. Set **Server URL** to your Cloud Run service URL:
   ```
   https://your-service-name-XXXXXXXXXX.REGION.run.app
   ```
3. Set **Auth Token** to the same `AUTH_TOKEN` value you set in Cloud Run env vars
4. The extension automatically converts the URL to `wss://` and appends `?token=` for the WebSocket connection

> No `gcloud proxy` needed — the extension connects directly to Cloud Run, which natively supports WebSockets over HTTPS.

---

## Step 14 — Verify Deployment

1. **Check Cloud Run service is running:**
   ```bash
   gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)"
   ```

2. **Check SSL certificate status** (should be `ACTIVE`):
   ```bash
   gcloud compute ssl-certificates describe meet-hld-cert --global --format="get(managed.status)"
   ```

3. **Check IAP is enabled:**
   ```bash
   gcloud iap web get-iam-policy --resource-type=backend-services --service=meet-hld-backend
   ```

4. **Test access:**
   Open `https://your-app.example.com` in a browser — you should see the Google login screen (IAP), then the dashboard.

---

## Updating the Application

To deploy a new version:

```bash
# Build and push new image
docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest

# Deploy new revision
gcloud run deploy $SERVICE_NAME \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/meet-hld-agent/${SERVICE_NAME}:latest \
  --region=$REGION
```

---

## Environment Variables Reference

Set these via `--set-env-vars` during deploy or in the Cloud Console:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `AUTH_TOKEN` | Yes | Shared secret for WebSocket authentication (Chrome extension sends this as `?token=`) |
| `GCS_BUCKET_NAME` | No | GCS bucket for saving meeting data |
| `LOG_LEVEL` | No | Logging level (default: `info`) |
| `AUDIO_CHUNK_MS` | No | Audio chunk interval in ms (default: `250`) |
| `DESIGN_DETECT_DEBOUNCE_MS` | No | Debounce for design detection (default: `15000`) |
| `DIAGRAM_UPDATE_INTERVAL_MS` | No | Diagram update interval (default: `30000`) |

> `PORT` is automatically set by Cloud Run — do not override it.

---

## Cost Considerations

| Resource | Estimated Cost |
|----------|---------------|
| Cloud Run (1 min instance, 1 vCPU, 1GB) | ~$30–50/month |
| Load Balancer (forwarding rule) | ~$18/month |
| SSL Certificate | Free (Google-managed) |
| IAP | Free |
| Static IP | Free while in use |

---

## Troubleshooting

### WebSocket connections failing
- Ensure `--timeout=3600` is set on both Cloud Run and the backend service
- Verify `--session-affinity` is enabled on Cloud Run
- Check that the backend service timeout matches: `--timeout-sec=3600`

### IAP login loop
- Verify the OAuth redirect URI includes the correct Client ID
- Check that the user has `roles/iap.httpsResourceAccessor` role
- Wait 5 minutes after granting access — IAM changes can take time to propagate

### SSL certificate stuck in PROVISIONING
- Verify DNS A record points to the static IP
- Google-managed certificates can take up to 30 minutes
- Check: `gcloud compute ssl-certificates describe meet-hld-cert --global`

### Cold start latency
- Use `--min-instances=1` to keep at least one instance warm
- Cloud Run cold starts are typically 3–5 seconds for this app

### Cloud Run returns 403
- This is expected when accessing the Cloud Run URL directly
- Access through the Load Balancer domain instead (`https://your-app.example.com`)
