# Meet HLD Agent - Presentation Content

---

## Slide 1: Title Slide

**Meet HLD Agent**
*AI-Powered Real-Time System Design Diagram Generator for Google Meet*

- POC / Innovation Project
- Tech Stack: Node.js, TypeScript, Gemini AI (Live API + REST API), Chrome Extension, Socket.IO, Mermaid.js
- Deployed on Google Cloud Run with App-Level Token Authentication
- AI Models: `gemini-2.5-flash-native-audio-latest` (Live) + `gemini-3.1-pro-preview` (REST)

---

## Slide 2: Problem Statement

- During system design discussions on Google Meet, participants discuss complex architectures verbally
- No real-time visual representation is created during the meeting
- Meeting participants often lose track of architectural decisions
- Post-meeting documentation is time-consuming and often incomplete
- There is no automated way to capture and visualize design discussions as they happen

---

## Slide 3: Key Constraint - Google Meet Media API Unavailability

> **Google Meet Media API is NOT publicly available.** Google has not released a public API for accessing meeting audio/video streams programmatically.

**Impact:**
- Cannot directly access meeting audio via API calls
- No server-side integration with Google Meet audio streams
- Traditional bot-based approaches (like joining via API) are not possible

**Our Solution:**
- We use a **custom Chrome Extension (Manifest V3)** to capture tab audio directly from the browser
- The extension uses Chrome's `tabCapture` API to record the audio from the Google Meet tab
- Audio is streamed via WebSocket to our backend server for AI processing
- This is a client-side workaround that works reliably without needing Google Meet API access

---

## Slide 4: Solution Overview

**Meet HLD Agent** is an AI-powered tool that:

1. **Captures** meeting audio via a Chrome Extension (since Meet Media API is unavailable)
2. **Transcribes** the conversation in real-time using Gemini Live API (`gemini-2.5-flash-native-audio-latest`)
3. **Detects** system design discussions using keyword heuristics + AI-flagging
4. **Generates** live Mermaid.js architecture diagrams automatically using Gemini REST API (`gemini-3.1-pro-preview`)
5. **Accepts voice commands** — participants can say *"Hey Sri, add a reporting service with OLAP database"* and the diagram updates live
6. **Defers heavy processing** — summary, advice, and tasks are generated on stop-capture for optimal real-time performance
7. **Displays** everything on a real-time web dashboard with zoom controls
8. **Saves** meeting artifacts (transcript, diagrams, summaries) to Google Cloud Storage
9. **Preserves state** on page refresh — all data persists until explicitly cleared

---

## Slide 5: Architecture Diagram

```
                          Google Meet Tab (Browser)
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │  Chrome Extension (MV3)  │
                    │  ├── popup.js (config)   │
                    │  ├── background.js       │
                    │  └── offscreen.js         │
                    │      (tabCapture + WS)    │
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
              │  │    │                (cookie auth)       │  │
              │  │    ├── /api/*       REST APIs           │  │
              │  │    ├── /socket.io   Real-time events    │  │
              │  │    └── /audio-ws    Audio WebSocket     │  │
              │  │         (persistent, token auth)        │  │
              │  └──────────────┬──────────────────────────┘  │
              │                 │                              │
              │                 ▼                              │
              │         ffmpeg (WebM/Opus → PCM 16kHz mono)   │
              │                 │                              │
              │                 ▼                              │
              │     Gemini Live API (WebSocket)                │
              │       model: gemini-2.5-flash-native-audio     │
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
              │     │      (cumulative dedup,    │             │
              │     │       3s flush timer)      │             │
              │     └───────────┬───────────────┘              │
              │                 │                              │
              │      ┌──────────┴──────────┐                   │
              │      ▼ (real-time)         ▼ (on stop-capture) │
              │  Gemini REST API      Gemini REST API           │
              │  gemini-3.1-pro       gemini-3.1-pro            │
              │  └── Mermaid.js       ├── Meeting Summary       │
              │      diagram          ├── Architecture Advice   │
              │      (auto-styled)    └── Task Breakdown        │
              │                 │                              │
              │                 ▼                              │
              │     Socket.IO → Dashboard (real-time push)     │
              │     (sends full state on reconnect)            │
              │                 │                              │
              │                 ▼                              │
              │     Google Cloud Storage (persistence)         │
              └──────────────────────────────────────────────┘
                                │
                                ▼
                   User's Browser (Dashboard)
                   ├── Mermaid.js diagram (60% initial zoom)
                   ├── Live transcript
                   ├── Floating popups: Summary, Suggestions,
                   │   Tasks, Transcript
                   └── Controls: Update, Clear, Save, Load
```

---

## Slide 6: Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Audio Capture | Chrome Extension (MV3) + tabCapture API | Capture Google Meet tab audio |
| Audio Transport | WebSocket (`/audio-ws` with persistent server) | Stream audio from extension to server |
| Audio Processing | ffmpeg | Transcode WebM/Opus to PCM (16kHz, 16-bit, mono) |
| Transcription | Gemini Live API (`gemini-2.5-flash-native-audio-latest`) | Real-time speech-to-text with cumulative deduplication |
| Design Detection | Keyword heuristic + Gemini AI [DESIGN] flag | Identify system design discussions |
| Diagram Generation | Gemini REST API (`gemini-3.1-pro-preview`) | Generate Mermaid.js code from transcript |
| Content Generation | Gemini REST API (deferred to stop-capture) | Summary, advice, and tasks generation |
| Real-time Dashboard | Express + Socket.IO + Mermaid.js | Live visualization with state preservation |
| Storage | Google Cloud Storage (GCS) | Persist meeting data |
| Deployment | Docker + GCP Cloud Run | Containerized cloud deployment |
| Authentication | App-level AUTH_TOKEN (cookie + WebSocket) | Login page + token-based WebSocket auth |
| Language | TypeScript / Node.js | Backend runtime |

---

## Slide 7: Chrome Extension - Audio Capture Flow

Since **Google Meet Media API is not available**, we built a custom Chrome Extension:

1. **Manifest V3** extension with `tabCapture` and `offscreen` permissions
2. User configures **Server URL** and **Auth Token** in the extension popup
3. User clicks "Start Capture" while on a Google Meet tab
4. Extension creates an **offscreen document** for audio processing
5. `chrome.tabCapture.capture()` captures the tab's audio stream
6. Audio is encoded and sent via **WebSocket** to the backend at `/audio-ws?token=AUTH_TOKEN`
7. Backend receives audio and pipes through ffmpeg for format conversion

**Key Design Decisions:**
- `chrome.storage.sync` is NOT available in offscreen documents — config is passed via messages from background.js
- WebSocket URL is built from the Server URL: `https://` → `wss://` + `/audio-ws?token=`
- All services (HTTP, WebSocket, Socket.IO) run on a **single port** for Cloud Run compatibility

---

## Slide 8: AI Processing Pipeline

### Stage 1: Real-Time Transcription
- Audio chunks (250ms PCM segments) sent to **Gemini Live API** via WebSocket
- Model: `gemini-2.5-flash-native-audio-latest` with `responseModalities: ['AUDIO']`
- `inputAudioTranscription` enabled for speech-to-text
- `outputAudioTranscription` enabled for detecting model's [DESIGN] response
- **Cumulative deduplication** — detects if Gemini sends full transcript vs incremental fragments
- **3-second flush timer** — waits for complete phrases before emitting to dashboard

### Stage 2: Design Detection
- **Keyword heuristic**: Scans accumulated transcript (last 2 min) for terms like "architecture", "microservice", "database", "API gateway", "load balancer", etc.
- **AI flag**: Gemini model flags design content with `[DESIGN]` tag via outputTranscription
- Detection is debounced (every 15 seconds) to avoid excessive API calls

### Stage 3: Diagram Generation (Real-Time)
When design discussion is detected:
- **Mermaid.js diagram** generated from last 2 minutes of transcript using `gemini-3.1-pro-preview`
- Auto-styled with color-coded nodes (blue=databases, purple=services, orange=queues, green=external, red=caches)
- Sent to dashboard via Socket.IO at 60% initial zoom

### Stage 4: Content Generation (On Stop-Capture)
When the Chrome extension stops capture, three parallel requests are made:
- **Meeting summary** — structured HTML with topic, key components, data flow
- **Architecture advice** — specific recommendations (reliability, scalability, security, etc.)
- **Task breakdown** — Jira-style task cards with priorities, descriptions, acceptance criteria, and AI-assisted time estimates

---

## Slide 9: Live Voice Commands - "Hey Sri"

### The Problem
During a meeting, manually clicking buttons to update diagrams breaks the discussion flow.

### The Solution
Participants can speak directly to the agent during the meeting:

> *"Hey Sri, add a Redis cache between the API gateway and the database"*

### How It Works
1. **Trigger Detection** — Continuous monitoring for wake phrases:
   - Primary: "Hey Sri" (variants: Sree, Shri, Shree, Siri)
   - Fallback: "Hey Agent", "Hey HLD"
   - Speech recognition variants handled: Three, Tree, Free, See
2. **Instruction Extraction** — Everything after the trigger phrase is the instruction
3. **Diagram Update** — Full session transcript + instruction sent to Gemini REST API
4. **Live Feedback** — Dashboard shows green banner with instruction text, then "Done!" on completion

### Example Voice Commands
| Voice Command | Action |
|--------------|--------|
| *"Hey Sri, add a Redis cache between the API gateway and the database"* | Adds a cache layer to the diagram |
| *"Hey Sri, replace Kafka with RabbitMQ"* | Swaps the message broker component |
| *"Hey Sri, add a reporting service that reads from an OLAP database"* | Adds reporting service + OLAP DB nodes |
| *"Hey Sri, show async communication between order and notification"* | Updates edge to dashed async arrow |
| *"Hey Sri, split the monolith into user service and payment service"* | Refactors the architecture diagram |

### Safety
- **10-second cooldown** between voice commands to prevent accidental triggers
- **Minimum instruction length** required (>10 chars) to avoid false positives
- Commands logged in transcript with special voice command tag

---

## Slide 10: Real-Time Dashboard

The web dashboard provides:

- **Mermaid.js Diagram Panel** — Auto-updating architecture diagram with:
  - 60% initial zoom (adjustable via +/- buttons or Ctrl+scroll)
  - "Fit" button to auto-fit to container
  - "Show Code" toggle to view raw Mermaid source
  - Color-coded nodes by type (database, service, queue, external, cache)
- **Floating Popup Widgets** (bottom-right):
  - **Tasks** — Jira-style task cards with priority, description, acceptance criteria
  - **Suggestions** — AI architecture recommendations
  - **Summary** — Meeting discussion summary
  - **Transcript** — Raw scrolling transcript with entry count
- **Voice Command Banner** — Green notification bar when voice command is detected
- **Controls**:
  - "Update Diagram" — Manual update with optional suggestion text
  - "Clear" — Resets ALL data (diagram, transcript, summary, suggestions, tasks)
  - "Save Meeting" — Persist to Google Cloud Storage
  - "Load Meeting" — Restore from GCS with "Regenerate All" option
- **State Preservation** — All data survives page refresh (server sends full state on reconnect)
- **Login Page** — Auth token required to access dashboard (cookie-based session)

---

## Slide 11: Key Features

| Feature | Description |
|---------|-------------|
| Real-time Transcription | Live speech-to-text via Gemini Live API with cumulative deduplication |
| Auto Design Detection | Keyword heuristic + AI [DESIGN] flag from Gemini |
| Live Mermaid.js Diagrams | Auto-generated, color-styled diagrams at 60% initial zoom |
| Voice Commands | Say *"Hey Sri, add a cache layer"* — diagram updates live |
| Deferred Content | Summary, advice, tasks generated on stop-capture (not real-time) for performance |
| Persistent WebSocket | `/audio-ws` stays alive — supports extension reconnections without 503 |
| State Preservation | Page refresh preserves all data (transcript, diagram, summary, etc.) |
| Clear All | Single button resets everything — diagram, transcript, summary, suggestions, tasks |
| Meeting Persistence | Save/load to Google Cloud Storage with regeneration support |
| Cookie Auth | Login page with AUTH_TOKEN → HTTP-only session cookie |
| Cloud Native | Single-port architecture, direct Cloud Run WebSocket, no proxy needed |

---

## Slide 12: Performance Optimizations

| Optimization | Before | After |
|-------------|--------|-------|
| Content generation | All 4 (diagram + summary + advice + tasks) on every design detection | Only diagram in real-time; summary/advice/tasks deferred to stop-capture |
| Transcript flushing | 2s timer, immediate flush on punctuation | 3s timer, no premature flush — fewer fragmented entries |
| Cumulative dedup | Not handled — duplicate text when Gemini sends full transcript | Detects cumulative vs incremental — extracts only new text |
| WebSocket server | Destroyed on disconnect — 503 on reconnect | Persistent WSS — survives reconnections |
| State on refresh | Lost all data except diagram | Server sends full state (transcript, summary, advice, tasks) to new connections |

---

## Slide 13: Deployment on GCP Cloud Run

### Architecture
```
Chrome Extension → wss://meet-hld-agent-XXX.run.app/audio-ws?token=AUTH_TOKEN
                        │
                        ▼ (direct HTTPS + WebSocket)
              Cloud Run Service
              (asia-south1 region)
              ┌─────────────────┐
              │ Single Port 8080│
              │ ├── Dashboard   │  ◄── Cookie-based login
              │ ├── /api/*      │
              │ ├── /socket.io  │
              │ └── /audio-ws   │  ◄── Token validated on upgrade
              └────────┬────────┘
                       │
                       ▼
              Google Cloud Storage
              (meeting persistence)
```

### Key Design Decisions
| Decision | Why |
|----------|-----|
| **Single port (8080)** | Cloud Run only supports one port per service |
| **Persistent WebSocket server** | `/audio-ws` stays alive — no 503 on extension reconnect |
| **App-level AUTH_TOKEN** | Browser WebSockets can't send IAM headers; token validated on WS upgrade |
| **Cookie-based dashboard auth** | Login page → session cookie → all routes protected |
| **Direct Cloud Run connection** | Cloud Run natively supports WebSockets over HTTPS — no proxy needed |
| **Deferred content generation** | Only diagram generated real-time; summary/advice/tasks on stop-capture |

### Build & Deploy
```bash
# One-command deploy from source
gcloud run deploy meet-hld-agent \
  --source . \
  --region=asia-south1 \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=key,GCS_BUCKET_NAME=bucket,AUTH_TOKEN=token"
```

---

## Slide 14: Demo Flow

1. **Open the dashboard** at your Cloud Run URL — enter AUTH_TOKEN to log in
2. **Configure the Chrome Extension** — set Server URL and Auth Token in popup
3. **Join a Google Meet** in Chrome
4. **Click the Chrome Extension** and hit "Start Capture"
5. **Begin discussing** system design topics in the meeting
6. **Watch the dashboard update in real-time:**
   - Transcript appears in the Transcript popup
   - Mermaid.js diagram auto-generates in the main panel
7. **Use voice commands** to refine the diagram:
   - Say: *"Hey Sri, add a reporting service connected to an OLAP database"*
   - Watch the green banner appear and diagram update live
8. **Stop capture** — summary, suggestions, and tasks are generated automatically
9. **Save the meeting** to GCS for future reference
10. **Clear** to reset all data and start fresh

---

## Slide 15: Security & Access Control

| Aspect | Implementation |
|--------|---------------|
| **WebSocket Auth** | AUTH_TOKEN validated on upgrade via `?token=` query param |
| **Dashboard Auth** | Login page → AUTH_TOKEN → HTTP-only session cookie (24h expiry) |
| **Socket.IO Auth** | Session cookie or handshake token |
| **Transport** | HTTPS / WSS (Google-managed TLS on Cloud Run URL) |
| **API Keys** | Gemini API key and AUTH_TOKEN stored as Cloud Run env vars |
| **No proxy needed** | Chrome extension connects directly to Cloud Run |

---

## Slide 16: Cost Analysis

| Resource | Cost |
|----------|------|
| Cloud Run (0 min instances, scale to zero) | ~$0 when idle, ~$5-15/month active use |
| Google Cloud Storage | ~$0.02/GB/month |
| Gemini API | Pay per token (see Google AI pricing) |
| SSL Certificate | Free (Google-managed) |
| Cloud Build | 120 min/day free tier |
| **Total infrastructure** | **~$5-15/month** (excluding Gemini API) |

---

## Slide 17: Limitations & Future Scope

### Current Limitations
- **Google Meet Media API not available** — relies on Chrome Extension for audio capture
- Chrome Extension must run on the same machine as the meeting participant
- Audio quality depends on the user's tab audio output
- AUTH_TOKEN must be shared with Chrome extension users
- Requires the user to keep the Google Meet tab active

### Future Scope
- Integrate with **Google Meet Media API** when it becomes publicly available
- **Gemini image generation** for architecture diagrams (visual diagrams instead of Mermaid)
- Support for **multiple diagram types** (sequence diagrams, ER diagrams, C4 model)
- **Multi-language** transcription support
- **Speaker diarization** — identify who said what
- **Meeting recording** with synchronized diagram timeline
- Export diagrams to **Confluence, Notion, or Google Docs**
- **Slack/Teams integration** for sharing diagrams post-meeting
- Add **IAP (Identity-Aware Proxy)** with custom domain for Google-account-based auth

---

## Slide 18: Summary

- **Meet HLD Agent** automates creation of system design diagrams during Google Meet calls
- Uses **Gemini Live API** (`gemini-2.5-flash-native-audio-latest`) for real-time transcription
- Uses **Gemini REST API** (`gemini-3.1-pro-preview`) for diagram and content generation
- **Chrome Extension** approach works around the lack of Google Meet Media API
- **Performance optimized** — only diagram in real-time; summary/advice/tasks deferred to stop-capture
- **Robust connectivity** — persistent WebSocket server, state preservation on refresh, cumulative transcript deduplication
- **Voice commands** via "Hey Sri" — natural language diagram updates during meetings
- **Cloud-native** deployment on GCP Cloud Run with cookie-based auth
- Reduces post-meeting documentation effort and captures architectural decisions as they're made

---

## Slide 19: Thank You

**Meet HLD Agent**
*Turning conversations into architecture diagrams, in real-time.*

**Tech Stack:** TypeScript, Node.js, Gemini AI (Live API + REST API), Chrome Extension, Socket.IO, Mermaid.js, Docker, GCP Cloud Run

**AI Models:** `gemini-2.5-flash-native-audio-latest` (transcription) + `gemini-3.1-pro-preview` (generation)

**Deployed:** Google Cloud Run (asia-south1) with App-Level Token Authentication

**Repository:** meet_hld_agent
