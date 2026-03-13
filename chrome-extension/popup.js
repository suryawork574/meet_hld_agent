const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.className = `status-${state}`;
}

function setRecording(isRecording) {
  startBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
  startBtn.style.display = isRecording ? 'none' : 'block';
  stopBtn.style.display = isRecording ? 'block' : 'none';
}

// Check current state on popup open — uses persisted session storage
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (chrome.runtime.lastError) {
    // Service worker not ready yet, default to idle
    setStatus('Idle — Not capturing', 'idle');
    setRecording(false);
    return;
  }
  if (response?.capturing) {
    setStatus('Recording...', 'recording');
    setRecording(true);
  } else {
    setStatus('Idle — Not capturing', 'idle');
    setRecording(false);
  }
});

startBtn.addEventListener('click', async () => {
  setStatus('Starting...', 'idle');
  startBtn.disabled = true;

  // Get the active tab — popup click gives us activeTab permission
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    setStatus('No active tab found', 'error');
    startBtn.disabled = false;
    return;
  }

  if (!tab.url?.includes('meet.google.com/')) {
    setStatus('Not a Google Meet tab', 'error');
    startBtn.disabled = false;
    return;
  }

  chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId: tab.id }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      startBtn.disabled = false;
      return;
    }
    if (response?.error) {
      setStatus(`Error: ${response.error}`, 'error');
      startBtn.disabled = false;
    } else {
      setStatus('Recording...', 'recording');
      setRecording(true);
    }
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, () => {
    setStatus('Idle — Not capturing', 'idle');
    setRecording(false);
  });
});

// Listen for status updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CAPTURE_STATUS') {
    if (message.status === 'recording') {
      setStatus('Recording...', 'recording');
      setRecording(true);
    } else if (message.status === 'stopped') {
      setStatus('Idle — Not capturing', 'idle');
      setRecording(false);
    } else if (message.status === 'error') {
      setStatus(`Error: ${message.error}`, 'error');
      setRecording(false);
    }
  }
});
