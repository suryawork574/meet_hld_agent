# Testing Guide — End-to-End Flow

## Prerequisites

- Google Chrome browser

## Setup

1. Download the Chrome extension
   - Go to https://github.com/suryawork574/meet_hld_agent/tree/main/chrome-extension
   - Download the `chrome-extension` folder (or clone the repo and use the folder)

2. Install the Chrome extension
   - Open `chrome://extensions/` in Chrome
   - Turn on **Developer mode** (top-right)
   - Click **Load unpacked** and select the downloaded `chrome-extension` folder

3. Click the extension icon in the toolbar and configure:
   - **Server URL**: `https://meet-hld-agent-55511404130.asia-south1.run.app`
   - **Auth Token**: `9f6a74f5df91eef32043d3fbf0036768`
   - Click Save

4. Open the dashboard at https://meet-hld-agent-55511404130.asia-south1.run.app and enter the Auth Token `9f6a74f5df91eef32043d3fbf0036768` when prompted. Keep this tab open.

## Test the Flow

1. Open **Google Meet** in another tab and start or join a meeting (you can test alone).

2. Click the **Meet Audio Capture** extension icon and click **Start Capture**. The dashboard status should show "Connected".

3. Start speaking about a system design topic. For example:

   > "We are building an e-commerce application. The user sends requests to a load balancer, which routes to an API gateway. The API gateway connects to a user service and an order service. Both services talk to a PostgreSQL database. We also need a Redis cache in front of the database and a Kafka message queue between the order service and a notification service."

4. Within a few seconds, the **Transcript** widget on the dashboard will show your speech in real-time.

5. Once the system detects enough design keywords, a **Mermaid.js architecture diagram** will auto-generate in the center of the dashboard. You don't need to click anything — it happens automatically.

6. Now try a **voice command**. Say:

   > "Hey Sri, add a CDN in front of the load balancer for static content"

   A banner will appear on the dashboard confirming the voice command, and the diagram will update with the new component.

7. Click **Stop Capture** in the extension popup. The system will now generate:
   - **Summary** — overview of what was discussed
   - **Suggestions** — architectural recommendations
   - **Tasks** — implementation task cards with priorities and timelines

   Click each widget button on the right side of the dashboard to view them.

8. You can click **Show Code** on the diagram to see the raw Mermaid.js syntax, use **+/-** to zoom, or click **Fit** to auto-fit.

9. To save the meeting, click **Save Meeting**, enter a meeting ID and date, and click Save.

10. Click **Clear** to reset everything. To verify persistence, click **Load Meeting** with the same meeting ID and date — the diagram and transcript will restore.

That's the complete flow.
