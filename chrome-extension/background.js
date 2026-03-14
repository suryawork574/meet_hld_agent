// Background service worker for tab audio capture
// Uses chrome.storage.session to persist state across service worker restarts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CAPTURE' && message.tabId) {
    getState().then((state) => {
      if (state.capturing) {
        sendResponse({ error: 'Already capturing' });
        return;
      }
      startCapture(message.tabId)
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ error: e.message }));
    });
    return true; // async response
  }

  if (message.type === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'GET_STATUS') {
    getState().then((state) => {
      sendResponse({ capturing: state.capturing, tabId: state.tabId });
    });
    return true; // async response
  }

  // Status from offscreen — no response needed
  if (message.type === 'CAPTURE_STATUS') {
    console.log('[BG] Capture status:', message.status);
    if (message.status === 'error' || message.status === 'stopped') {
      setState({ capturing: false, tabId: null });
    }
  }

  return false;
});

async function getState() {
  try {
    const result = await chrome.storage.session.get(['capturing', 'tabId']);
    return {
      capturing: result.capturing || false,
      tabId: result.tabId || null,
    };
  } catch {
    return { capturing: false, tabId: null };
  }
}

async function setState(state) {
  try {
    await chrome.storage.session.set(state);
  } catch (e) {
    console.warn('[BG] Failed to persist state:', e);
  }
}

async function startCapture(tabId) {
  console.log('[BG] Starting capture for tab:', tabId);

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(id);
      }
    });
  });

  console.log('[BG] Got streamId:', streamId?.substring(0, 30));

  // Create offscreen document for recording
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Recording tab audio for transcription',
    });
    console.log('[BG] Offscreen document created');
  } catch (e) {
    console.log('[BG] Offscreen doc already exists:', e.message);
  }

  // Get saved server URL and auth token
  const stored = await chrome.storage.sync.get(['serverUrl', 'authToken']);

  // Tell offscreen doc to start capturing
  chrome.runtime.sendMessage({
    type: 'OFFSCREEN_START',
    streamId: streamId,
    serverUrl: stored.serverUrl || '',
    authToken: stored.authToken || '',
  });

  await setState({ capturing: true, tabId: tabId });
}

async function stopCapture() {
  console.log('[BG] Stopping capture');
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  await setState({ capturing: false, tabId: null });
}
