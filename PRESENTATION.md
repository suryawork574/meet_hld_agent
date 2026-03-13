# Meet HLD Agent - Presentation Content

---

## Slide 1: Title Slide

**Meet HLD Agent**
*AI-Powered Real-Time System Design Diagram Generator for Google Meet*

- POC / Innovation Project
- Tech Stack: Node.js, TypeScript, Gemini AI, Chrome Extension, Socket.IO

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
2. **Transcribes** the conversation in real-time using Gemini Live API
3. **Detects** system design discussions using keyword heuristics + AI-flagging
4. **Generates** live Mermaid.js architecture diagrams automatically
5. **Accepts voice commands** — participants can say *"Hey HLD Agent, add a reporting service with OLAP database"* and the diagram updates live
6. **Displays** everything on a real-time web dashboard
7. **Saves** meeting artifacts (transcript, diagrams, summaries) to Google Cloud Storage

---

## Slide 5: Architecture Diagram

```
User's Browser (Google Meet Tab)
        │
        ▼
Chrome Extension (tabCapture API) ──── Audio Stream via WebSocket
        │
        ▼
Backend Server (Node.js / TypeScript)
        │
        ├──► ffmpeg (WebM/Opus → PCM 16kHz mono)
        │
        ├──► Gemini Live API (WebSocket)
        │       └── Real-time transcription
        │       └── [DESIGN] flag detection
        │
        ├──► Design Detector (keyword heuristic)
        │
        ├──► Gemini REST API
        │       └── Mermaid.js diagram generation
        │       └── Meeting summary generation
        │       └── Architecture advice generation
        │
        ├──► Express + Socket.IO
        │       └── Real-time dashboard
        │
        └──► Google Cloud Storage
                └── Meeting data persistence
```

---

## Slide 6: Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Audio Capture | Chrome Extension (MV3) + tabCapture API | Capture Google Meet tab audio |
| Audio Transport | WebSocket (ws) | Stream audio from extension to server |
| Audio Processing | ffmpeg | Transcode WebM/Opus to PCM (16kHz, 16-bit, mono) |
| Transcription | Gemini Live API (WebSocket) | Real-time speech-to-text |
| Design Detection | Custom keyword heuristic + Gemini AI flag | Identify system design discussions |
| Diagram Generation | Gemini REST API (gemini-2.5-flash) | Generate Mermaid.js code from transcript |
| Real-time Dashboard | Express + Socket.IO + Mermaid.js | Live visualization |
| Storage | Google Cloud Storage (GCS) | Persist meeting data |
| Deployment | Docker + GCP Cloud Run | Containerized cloud deployment |
| Language | TypeScript / Node.js | Backend runtime |

---

## Slide 7: Chrome Extension - Audio Capture Flow

Since **Google Meet Media API is not available**, we built a custom Chrome Extension:

1. **Manifest V3** extension with `tabCapture` and `offscreen` permissions
2. User clicks "Start Capture" on the extension popup while on a Google Meet tab
3. Extension creates an **offscreen document** for audio processing
4. `chrome.tabCapture.capture()` captures the tab's audio stream
5. Audio is encoded and sent via **WebSocket** to the backend server on port 3001
6. The backend receives the audio stream and pipes it through ffmpeg for format conversion

**Why Chrome Extension?**
- Google Meet does not expose a public Media API for third-party audio access
- Chrome's `tabCapture` API is the only reliable way to capture meeting audio
- Works without any Google Meet API keys or OAuth scopes for meeting media

---

## Slide 8: AI Processing Pipeline

### Stage 1: Real-Time Transcription
- Audio chunks (250ms segments) are base64-encoded and sent to **Gemini Live API** via WebSocket
- Gemini returns transcribed text in real-time
- Model is instructed to flag design discussions with `[DESIGN]` prefix

### Stage 2: Design Detection
- **Keyword heuristic**: Scans transcript for terms like "architecture", "microservice", "database", "API gateway", "load balancer", etc.
- **AI flag**: Gemini model also flags design content with `[DESIGN]` tag
- Detection is debounced (every 15 seconds) to avoid excessive API calls

### Stage 3: Diagram + Summary Generation (Parallel)
When design discussion is detected, three parallel requests are made to **Gemini REST API**:
- **Mermaid.js diagram** generation from the last 2 minutes of transcript
- **Meeting summary** generation in bullet-point format
- **Architecture advice** with best practices and recommendations

---

## Slide 9: Live Voice Commands - "Hey HLD Agent"

### The Problem
During a meeting, manually clicking buttons to update diagrams breaks the discussion flow.

### The Solution
Participants can speak directly to the agent during the meeting:

> *"Hey HLD Agent, can you update the diagram to add an extra service to generate reports using OLAP database"*

### How It Works
1. **Trigger Detection** — The system continuously monitors the transcript for wake phrases:
   - "Hey HLD Agent", "Hey Agent", "Hey Diagram Agent", etc.
2. **Instruction Extraction** — Everything after the trigger phrase is extracted as the instruction
   - E.g., *"add an extra service to generate reports using OLAP database"*
3. **Diagram Update** — The instruction is sent to Gemini REST API along with the full session transcript
   - Gemini updates the existing diagram, preserving current components and adding new ones per the instruction
4. **Live Feedback** — The dashboard shows:
   - A green banner: "Voice Command Detected" with the instruction text
   - The transcript highlights the voice command entry
   - The diagram auto-updates within seconds
   - Banner shows "Done!" when complete

### Example Voice Commands
| Voice Command | Action |
|--------------|--------|
| *"Hey HLD Agent, add a Redis cache between the API gateway and the database"* | Adds a cache layer to the diagram |
| *"Hey Agent, replace Kafka with RabbitMQ"* | Swaps the message broker component |
| *"Hey HLD Agent, add a reporting service that reads from an OLAP database"* | Adds reporting service + OLAP DB nodes |
| *"Hey Agent, show async communication between order service and notification service"* | Updates edge to dashed async arrow |
| *"Hey HLD Agent, split the monolith into user service and payment service"* | Refactors the architecture diagram |

### Safety
- **10-second cooldown** between voice commands to prevent accidental triggers
- **Minimum instruction length** required (>10 chars) to avoid false positives
- Commands are logged in the transcript with a special voice command tag

---

## Slide 10: Real-Time Dashboard

The web dashboard provides:

- **Live Transcript Panel** - Scrolling transcript with highlighted design-related segments
- **Mermaid.js Diagram Panel** - Auto-updating architecture diagram rendered in SVG
- **Meeting Summary Panel** - AI-generated bullet-point summary
- **Architecture Advice Panel** - Best practice recommendations
- **Manual Controls**:
  - "Update Diagram" button with optional suggestion text
  - "Reset Diagram" to clear and start fresh
  - "Save Meeting" to persist data to GCS
  - "Load Meeting" to restore previous meeting data
- **Status Indicators** - Connection state for Gemini, extension, and WebSocket

---

## Slide 10: Key Features

| Feature | Description |
|---------|-------------|
| Real-time Transcription | Live speech-to-text using Gemini Live API |
| Auto Design Detection | Keyword heuristic + AI-based detection of design discussions |
| Live Diagram Generation | Automatic Mermaid.js diagrams updated as discussion evolves |
| Voice Commands | Say *"Hey HLD Agent, add a cache layer"* — diagram updates live from voice |
| Meeting Summaries | AI-generated summaries of key discussion points |
| Architecture Advice | Context-aware recommendations and best practices |
| Manual Diagram Control | Users can trigger updates with custom suggestions via dashboard |
| Meeting Persistence | Save/load meeting data to/from Google Cloud Storage |
| Cloud Deployment | Dockerized and deployable to GCP Cloud Run |

---

## Slide 11: Deployment on GCP Cloud Run

### Steps:
1. **Build Docker image** - Application is containerized with Node.js 20 + ffmpeg
2. **Push to Artifact Registry** - Image stored in GCP Artifact Registry
3. **Deploy to Cloud Run** - Serverless container deployment
4. **Configure secrets** - Gemini API key stored in GCP Secret Manager
5. **Set up GCS bucket** - For meeting data persistence
6. **Update Chrome Extension** - Point WebSocket URL to Cloud Run service URL

### Cloud Run Configuration:
- **Port:** 3000
- **Memory:** 512Mi
- **CPU:** 1 vCPU
- **Timeout:** 3600s (long-running WebSocket connections)
- **Min instances:** 0 (scale to zero when idle)
- **Max instances:** 3

---

## Slide 12: Demo Flow

1. Start the backend server (`npm run dev` or deploy to Cloud Run)
2. Open Google Meet in Chrome and join a meeting
3. Click the Chrome Extension popup and hit "Start Capture"
4. Open the dashboard at `http://localhost:3000` (or Cloud Run URL)
5. Begin discussing system design topics in the meeting
6. Watch the dashboard update in real-time:
   - Transcript appears on the left
   - Mermaid.js diagram auto-generates on the right
   - Summary and advice panels update
7. **Use voice commands** to refine the diagram during the meeting:
   - Say: *"Hey HLD Agent, add a reporting service connected to an OLAP database"*
   - Watch the green banner appear and diagram update live
8. Optionally save the meeting data to GCS for future reference

---

## Slide 13: Limitations & Future Scope

### Current Limitations
- **Google Meet Media API not available** - relies on Chrome Extension for audio capture (requires user to manually start capture)
- Chrome Extension must run on the same machine as the meeting participant
- Audio quality depends on the user's tab audio output
- Requires the user to keep the Google Meet tab active

### Future Scope
- Integrate with **Google Meet Media API** when it becomes publicly available
- Support for **multiple diagram types** (sequence diagrams, ER diagrams, C4 model)
- **Multi-language** transcription support
- **Speaker diarization** - identify who said what
- **Meeting recording** with synchronized diagram timeline
- Export diagrams to **Confluence, Notion, or Google Docs**
- **Slack/Teams integration** for sharing diagrams post-meeting

---

## Slide 14: Summary

- **Meet HLD Agent** automates the creation of system design diagrams during Google Meet calls
- Uses **Gemini AI** for both transcription and diagram generation
- **Chrome Extension** approach works around the lack of Google Meet Media API
- **Real-time dashboard** provides instant visual feedback
- **Cloud-native** deployment on GCP Cloud Run with GCS storage
- Reduces post-meeting documentation effort and captures architectural decisions as they're made

---

## Slide 15: Thank You

**Meet HLD Agent**
*Turning conversations into architecture diagrams, in real-time.*

**Tech Stack:** TypeScript, Node.js, Gemini AI, Chrome Extension, Socket.IO, Mermaid.js, Docker, GCP Cloud Run

**Repository:** meet_hld_agent
