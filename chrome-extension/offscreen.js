// Offscreen document for handling MediaRecorder with tab audio
// Captures audio from a tab using the streamId from tabCapture

let recorder = null;
let wsConnection = null;

function buildWsUrl(baseUrl, token) {
  // Convert HTTP(S) URL to WS(S) URL with /audio-ws path
  let url = (baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
  if (url.startsWith('https://')) {
    url = 'wss://' + url.substring(8);
  } else if (url.startsWith('http://')) {
    url = 'ws://' + url.substring(7);
  } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = 'ws://' + url;
  }
  if (!url.endsWith('/audio-ws')) {
    url += '/audio-ws';
  }
  if (token) {
    url += '?token=' + encodeURIComponent(token);
  }
  return url;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_START') {
    const wsUrl = buildWsUrl(message.serverUrl, message.authToken);
    handleStart(message.streamId, wsUrl);
  }

  if (message.type === 'OFFSCREEN_STOP') {
    handleStop();
  }

  return false; // no async response
});

async function handleStart(streamId, wsUrl) {
  console.log('[Offscreen] Starting capture with streamId:', streamId?.substring(0, 30));

  try {
    // Get the media stream using the tab capture streamId
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    console.log('[Offscreen] Got media stream, audio tracks:', stream.getAudioTracks().length);

    // Connect to the Node.js server via WebSocket
    console.log('[Offscreen] Connecting to WebSocket:', wsUrl);
    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
      console.log('[Offscreen] WebSocket connected to Node.js server');

      // Start MediaRecorder
      recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0 && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
          const buffer = await e.data.arrayBuffer();
          wsConnection.send(buffer);
        }
      };

      recorder.start(250); // Collect data every 250ms
      console.log('[Offscreen] MediaRecorder started');

      chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS', status: 'recording' });
    };

    wsConnection.onerror = () => {
      console.error('[Offscreen] WebSocket error — cannot connect to:', wsUrl);
      chrome.runtime.sendMessage({
        type: 'CAPTURE_STATUS',
        status: 'error',
        error: `Cannot connect to server at ${wsUrl}. Check the Server URL in extension settings.`,
      });
      stream.getTracks().forEach(t => t.stop());
    };

    wsConnection.onclose = () => {
      console.log('[Offscreen] WebSocket closed');
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    };

  } catch (e) {
    console.error('[Offscreen] Error starting capture:', e);
    chrome.runtime.sendMessage({
      type: 'CAPTURE_STATUS',
      status: 'error',
      error: e.message || 'Failed to capture tab audio',
    });
  }
}

function handleStop() {
  console.log('[Offscreen] Stopping capture');
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
    recorder = null;
  }
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
  chrome.runtime.sendMessage({ type: 'CAPTURE_STATUS', status: 'stopped' });
}
