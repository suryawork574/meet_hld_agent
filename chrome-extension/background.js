// Background service worker for tab audio capture
// Triggered manually via popup Start/Stop buttons

let capturing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Messages from popup (have tabId or specific types)
  if (message.type === 'START_CAPTURE' && message.tabId) {
    if (capturing) {
      sendResponse({ error: 'Already capturing' });
      return false;
    }
    startCapture(message.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ error: e.message }));
    return true; // async response
  }

  if (message.type === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ capturing });
    return false;
  }

  // Status from offscreen — no response needed
  if (message.type === 'CAPTURE_STATUS') {
    console.log('[BG] Capture status:', message.status);
    if (message.status === 'error' || message.status === 'stopped') {
      capturing = false;
    }
  }

  return false; // no async response needed
});

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

  // Tell offscreen doc to start capturing
  chrome.runtime.sendMessage({
    type: 'OFFSCREEN_START',
    streamId: streamId,
  });

  capturing = true;
}

function stopCapture() {
  console.log('[BG] Stopping capture');
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  capturing = false;
}
