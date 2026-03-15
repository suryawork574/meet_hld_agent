// Initialize Mermaid with light theme for white background
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  themeVariables: {
    primaryColor: '#4361ee',
    primaryTextColor: '#1a1a2e',
    primaryBorderColor: '#3a56d4',
    lineColor: '#555',
    secondaryColor: '#e8eaf6',
    tertiaryColor: '#f5f5ff',
    background: '#ffffff',
    mainBkg: '#e3e8ff',
    nodeBorder: '#3a56d4',
    clusterBkg: '#f0f2ff',
    clusterBorder: '#c5cae9',
    titleColor: '#1a1a2e',
    edgeLabelBackground: '#ffffff',
    nodeTextColor: '#1a1a2e',
    fontSize: '14px',
  },
  flowchart: {
    curve: 'basis',
    padding: 24,
    nodeSpacing: 60,
    rankSpacing: 70,
    htmlLabels: true,
    useMaxWidth: false,
  },
  sequence: {
    actorMargin: 80,
    messageMargin: 40,
  },
  securityLevel: 'loose',
});

const socket = io();
const statusEl = document.getElementById('connection-status');
const meetStatusEl = document.getElementById('meet-status');
const diagramContainer = document.getElementById('diagram-container');
const mermaidOutput = document.getElementById('mermaid-output');
const mermaidSource = document.getElementById('mermaid-source');
const summaryContainer = document.getElementById('summary-container');
const transcriptContainer = document.getElementById('transcript-container');
const transcriptCount = document.getElementById('transcript-count');
const resetBtn = document.getElementById('reset-btn');
const updateDiagramBtn = document.getElementById('update-diagram-btn');
const toggleCodeBtn = document.getElementById('toggle-code');
const codeView = document.getElementById('diagram-code');

let showCode = false;
let renderCounter = 0;
let entryCount = 0;

// Track loaded meeting for regeneration
let loadedMeetingId = null;
let loadedMeetingDate = null;

// Zoom state
let currentZoom = 1;
const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;
const zoomLevelEl = document.getElementById('zoom-level');

function setZoom(level) {
  currentZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
  mermaidOutput.style.transform = `scale(${currentZoom})`;
  zoomLevelEl.textContent = `${Math.round(currentZoom * 100)}%`;
}

document.getElementById('zoom-in').addEventListener('click', () => setZoom(currentZoom + ZOOM_STEP));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(currentZoom - ZOOM_STEP));
document.getElementById('zoom-fit').addEventListener('click', () => {
  // Fit SVG to container
  const svg = mermaidOutput.querySelector('svg');
  if (svg) {
    const containerRect = diagramContainer.getBoundingClientRect();
    const svgWidth = svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width / currentZoom;
    const svgHeight = svg.viewBox?.baseVal?.height || svg.getBoundingClientRect().height / currentZoom;
    const fitZoom = Math.min(
      (containerRect.width - 48) / svgWidth,
      (containerRect.height - 48) / svgHeight,
      ZOOM_MAX
    );
    setZoom(fitZoom);
  } else {
    setZoom(1);
  }
});

// Mouse wheel zoom
diagramContainer.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(currentZoom + delta);
  }
}, { passive: false });

// Socket.IO events
socket.on('connect', () => {
  statusEl.textContent = 'Connected';
  statusEl.className = 'status connected';
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
  statusEl.className = 'status disconnected';
});

socket.on('status', (status) => {
  meetStatusEl.textContent = status;
  meetStatusEl.className = `status ${status.includes('Live') || status.includes('Meeting') ? 'connected' : 'processing'}`;
});

socket.on('transcript', (data) => {
  addTranscriptEntry(data.text, data.isDesign, data.timestamp);
});

// Voice command handling
const voiceBanner = document.getElementById('voice-command-banner');
const voiceText = document.getElementById('voice-command-text');
const voiceStatus = document.getElementById('voice-command-status');
let voiceBannerTimeout = null;

socket.on('voiceCommand', (data) => {
  // Show the voice command banner
  voiceText.textContent = `"${data.instruction}"`;
  voiceStatus.textContent = 'Updating diagram...';
  voiceBanner.classList.remove('hidden', 'done');

  // Clear any existing timeout
  if (voiceBannerTimeout) clearTimeout(voiceBannerTimeout);

  // Also add it to transcript as a special entry
  addVoiceCommandEntry(data.trigger, data.instruction, data.timestamp);

  // Listen for the diagram update to mark completion
  socket.once('diagram:update', () => {
    voiceStatus.textContent = 'Done!';
    voiceBanner.classList.add('done');
    voiceBannerTimeout = setTimeout(() => {
      voiceBanner.classList.add('hidden');
    }, 8000);
  });

  // Timeout fallback
  setTimeout(() => {
    if (!voiceBanner.classList.contains('done')) {
      voiceStatus.textContent = 'Processing...';
    }
  }, 15000);
});

function addVoiceCommandEntry(trigger, instruction, timestamp) {
  entryCount++;
  transcriptCount.textContent = `${entryCount} entries`;

  const entry = document.createElement('div');
  entry.className = 'transcript-entry voice-command';

  const time = new Date(timestamp).toLocaleTimeString();
  entry.innerHTML = `
    <div class="time">${time}</div>
    <div><span class="voice-tag">&#127908; VOICE COMMAND</span> ${escapeHtml(instruction)}</div>
  `;

  transcriptContainer.appendChild(entry);
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

socket.on('summary:update', (summaryHtml) => {
  summaryContainer.innerHTML = summaryHtml;
});

socket.on('advice:update', (adviceHtml) => {
  const adviceContainer = document.getElementById('advice-container');
  if (adviceHtml) {
    adviceContainer.innerHTML = adviceHtml;
  }
});

socket.on('tasks:update', (tasksHtml) => {
  const tasksContainer = document.getElementById('tasks-container');
  if (tasksHtml) {
    tasksContainer.innerHTML = tasksHtml;
  }
});

socket.on('diagram:update', async (mermaidCode) => {
  if (!mermaidCode) {
    mermaidOutput.innerHTML = `
      <div class="mermaid-placeholder">
        <div class="placeholder-icon">&#9881;</div>
        <div>Waiting for system design discussion...</div>
        <div class="placeholder-sub">Start discussing architecture, databases, APIs, etc.</div>
      </div>`;
    mermaidSource.textContent = '';
    return;
  }

  await renderDiagram(mermaidCode);
});

async function renderDiagram(mermaidCode) {
  mermaidSource.textContent = mermaidCode;
  try {
    renderCounter++;
    const id = `mermaid-diagram-${renderCounter}`;
    const { svg } = await mermaid.render(id, mermaidCode);
    mermaidOutput.innerHTML = svg;
    mermaidOutput.classList.remove('mermaid-placeholder');

    // Set initial zoom to 60%
    requestAnimationFrame(() => {
      setZoom(0.6);
    });
  } catch (err) {
    console.error('Mermaid render error:', err);
    mermaidOutput.innerHTML = `<div class="mermaid-placeholder">Diagram rendering error. Check Mermaid syntax.</div>`;
  }
}

// UI handlers
resetBtn.addEventListener('click', () => {
  if (confirm('Clear all data? This will reset diagram, transcript, summary, suggestions, and tasks.')) {
    socket.emit('clear:all');

    // Clear diagram
    mermaidOutput.innerHTML = `
      <div class="mermaid-placeholder">
        <div class="placeholder-icon">&#9881;</div>
        <div>Waiting for system design discussion...</div>
        <div class="placeholder-sub">Start discussing architecture, databases, APIs, etc.</div>
      </div>`;
    mermaidSource.textContent = '';

    // Clear transcript
    transcriptContainer.innerHTML = '';
    entryCount = 0;
    transcriptCount.textContent = '0 entries';

    // Clear summary
    summaryContainer.innerHTML = '<div class="summary-placeholder">Summary will appear as the discussion progresses...</div>';

    // Clear suggestions
    document.getElementById('advice-container').innerHTML = '';

    // Clear tasks
    document.getElementById('tasks-container').innerHTML = '<div class="tasks-placeholder">Tasks will be generated as the design discussion progresses...</div>';
  }
});

const suggestionModal = document.getElementById('suggestion-modal');
const suggestionInput = document.getElementById('suggestion-input');
const suggestionCancel = document.getElementById('suggestion-cancel');
const suggestionSubmit = document.getElementById('suggestion-submit');

updateDiagramBtn.addEventListener('click', () => {
  suggestionInput.value = '';
  suggestionModal.classList.remove('hidden');
  suggestionInput.focus();
});

suggestionCancel.addEventListener('click', () => {
  suggestionModal.classList.add('hidden');
});

suggestionModal.addEventListener('click', (e) => {
  if (e.target === suggestionModal) suggestionModal.classList.add('hidden');
});

suggestionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    suggestionSubmit.click();
  }
});

suggestionSubmit.addEventListener('click', () => {
  const suggestion = suggestionInput.value.trim();
  suggestionModal.classList.add('hidden');

  updateDiagramBtn.disabled = true;
  updateDiagramBtn.classList.add('loading');
  updateDiagramBtn.textContent = 'Generating...';

  socket.emit('diagram:requestUpdate', { suggestion });

  const enableBtn = () => {
    updateDiagramBtn.disabled = false;
    updateDiagramBtn.classList.remove('loading');
    updateDiagramBtn.textContent = 'Update Diagram';
  };
  socket.once('diagram:update', enableBtn);
  setTimeout(enableBtn, 30000);
});

toggleCodeBtn.addEventListener('click', () => {
  showCode = !showCode;
  codeView.classList.toggle('hidden', !showCode);
  toggleCodeBtn.textContent = showCode ? 'Hide Code' : 'Show Code';
});

function addTranscriptEntry(text, isDesign, timestamp) {
  entryCount++;
  transcriptCount.textContent = `${entryCount} entries`;

  const entry = document.createElement('div');
  entry.className = `transcript-entry ${isDesign ? 'design' : 'normal'}`;

  const time = new Date(timestamp).toLocaleTimeString();
  entry.innerHTML = `
    <div class="time">${time}</div>
    <div>${escapeHtml(text)}</div>
  `;

  transcriptContainer.appendChild(entry);
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;

  while (transcriptContainer.children.length > 200) {
    transcriptContainer.removeChild(transcriptContainer.firstChild);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===================== SAVE MEETING =====================
const saveMeetingBtn = document.getElementById('save-meeting-btn');
const saveModal = document.getElementById('save-modal');
const saveMeetingId = document.getElementById('save-meeting-id');
const saveMeetingDate = document.getElementById('save-meeting-date');
const saveCancel = document.getElementById('save-cancel');
const saveSubmit = document.getElementById('save-submit');
const saveStatus = document.getElementById('save-status');

saveMeetingBtn.addEventListener('click', () => {
  // Pre-fill date with today
  saveMeetingDate.value = new Date().toISOString().split('T')[0];
  saveMeetingId.value = '';
  saveStatus.classList.add('hidden');
  saveModal.classList.remove('hidden');
  saveMeetingId.focus();
});

saveCancel.addEventListener('click', () => {
  saveModal.classList.add('hidden');
});

saveModal.addEventListener('click', (e) => {
  if (e.target === saveModal) saveModal.classList.add('hidden');
});

saveSubmit.addEventListener('click', async () => {
  const meetingId = saveMeetingId.value.trim();
  const date = saveMeetingDate.value;

  if (!meetingId) {
    showSaveStatus('Please enter a Meeting ID', 'error');
    return;
  }
  if (!date) {
    showSaveStatus('Please select a date', 'error');
    return;
  }

  saveSubmit.disabled = true;
  saveSubmit.textContent = 'Saving...';

  try {
    const res = await fetch('/api/meetings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, date }),
    });

    const data = await res.json();
    if (res.ok) {
      showSaveStatus(`Saved successfully! Path: ${data.path}`, 'success');
      setTimeout(() => saveModal.classList.add('hidden'), 2000);
    } else {
      showSaveStatus(data.error || 'Failed to save', 'error');
    }
  } catch (err) {
    showSaveStatus('Network error: ' + err.message, 'error');
  } finally {
    saveSubmit.disabled = false;
    saveSubmit.textContent = 'Save';
  }
});

function showSaveStatus(message, type) {
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${type}`;
  saveStatus.classList.remove('hidden');
}

// ===================== LOAD MEETING =====================
const loadMeetingBtn = document.getElementById('load-meeting-btn');
const loadModal = document.getElementById('load-modal');
const loadMeetingId = document.getElementById('load-meeting-id');
const loadMeetingDate = document.getElementById('load-meeting-date');
const loadFetchBtn = document.getElementById('load-fetch-btn');
const loadCancel = document.getElementById('load-cancel');
const loadStatus = document.getElementById('load-status');
const meetingsList = document.getElementById('meetings-list');
const refreshMeetingsBtn = document.getElementById('refresh-meetings-btn');

loadMeetingBtn.addEventListener('click', () => {
  loadMeetingId.value = '';
  loadMeetingDate.value = '';
  loadStatus.classList.add('hidden');
  loadModal.classList.remove('hidden');
});

loadCancel.addEventListener('click', () => {
  loadModal.classList.add('hidden');
});

loadModal.addEventListener('click', (e) => {
  if (e.target === loadModal) loadModal.classList.add('hidden');
});

loadFetchBtn.addEventListener('click', async () => {
  const meetingId = loadMeetingId.value.trim();
  const date = loadMeetingDate.value;

  if (!meetingId || !date) {
    showLoadStatus('Please enter both Meeting ID and Date', 'error');
    return;
  }

  await loadMeeting(meetingId, date);
});

refreshMeetingsBtn.addEventListener('click', async () => {
  refreshMeetingsBtn.disabled = true;
  refreshMeetingsBtn.textContent = 'Loading...';

  try {
    const res = await fetch('/api/meetings');
    if (!res.ok) {
      const data = await res.json();
      meetingsList.innerHTML = `<div class="meetings-placeholder">${data.error || 'Failed to load'}</div>`;
      return;
    }

    const meetings = await res.json();
    if (meetings.length === 0) {
      meetingsList.innerHTML = '<div class="meetings-placeholder">No saved meetings found.</div>';
      return;
    }

    meetingsList.innerHTML = meetings.map(m => `
      <div class="meeting-item" data-meeting-id="${escapeHtml(m.meetingId)}" data-date="${escapeHtml(m.date)}">
        <div class="meeting-item-info">
          <span class="meeting-item-id">${escapeHtml(m.meetingId)}</span>
          <span class="meeting-item-date">${escapeHtml(m.date)}</span>
        </div>
        <span class="meeting-item-time">${m.savedAt ? new Date(m.savedAt).toLocaleString() : ''}</span>
      </div>
    `).join('');

    // Add click handlers
    meetingsList.querySelectorAll('.meeting-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.meetingId;
        const date = item.dataset.date;
        loadMeeting(id, date);
      });
    });
  } catch (err) {
    meetingsList.innerHTML = `<div class="meetings-placeholder">Error: ${err.message}</div>`;
  } finally {
    refreshMeetingsBtn.disabled = false;
    refreshMeetingsBtn.textContent = 'Refresh';
  }
});

async function loadMeeting(meetingId, date) {
  showLoadStatus('Loading meeting...', 'info');
  loadFetchBtn.disabled = true;

  try {
    const res = await fetch(`/api/meetings/load?meetingId=${encodeURIComponent(meetingId)}&date=${encodeURIComponent(date)}`);
    const data = await res.json();

    if (!res.ok) {
      showLoadStatus(data.error || 'Failed to load meeting', 'error');
      return;
    }

    // Populate the UI with loaded data
    // Clear current transcript
    transcriptContainer.innerHTML = '';
    entryCount = 0;

    // Load transcript entries
    if (data.transcript && data.transcript.length > 0) {
      data.transcript.forEach(entry => {
        addTranscriptEntry(entry.text, entry.isDesign, entry.timestamp);
      });
    }

    // Load summary
    if (data.summary) {
      summaryContainer.innerHTML = data.summary;
    }

    // Load diagram
    if (data.diagram) {
      await renderDiagram(data.diagram);
    }

    // Load advice
    if (data.advice) {
      document.getElementById('advice-container').innerHTML = data.advice;
    }

    // Load tasks
    if (data.tasks) {
      document.getElementById('tasks-container').innerHTML = data.tasks;
    }

    // Track loaded meeting for regeneration
    loadedMeetingId = meetingId;
    loadedMeetingDate = date;
    document.getElementById('regenerate-btn').classList.remove('hidden');

    showLoadStatus(`Loaded meeting: ${meetingId} (${date})`, 'success');
    setTimeout(() => loadModal.classList.add('hidden'), 1500);
  } catch (err) {
    showLoadStatus('Network error: ' + err.message, 'error');
  } finally {
    loadFetchBtn.disabled = false;
  }
}

function showLoadStatus(message, type) {
  loadStatus.textContent = message;
  loadStatus.className = `save-status ${type}`;
  loadStatus.classList.remove('hidden');
}

// ===================== REGENERATE =====================
const regenerateBtn = document.getElementById('regenerate-btn');

regenerateBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!loadedMeetingId || !loadedMeetingDate) return;

  regenerateBtn.disabled = true;
  regenerateBtn.classList.add('loading');
  regenerateBtn.textContent = '\u21BB Regenerating...';

  try {
    const res = await fetch('/api/meetings/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId: loadedMeetingId, date: loadedMeetingDate }),
    });

    const data = await res.json();

    if (res.ok) {
      // Update all popups with regenerated content
      if (data.summary) {
        summaryContainer.innerHTML = data.summary;
      }
      if (data.advice) {
        document.getElementById('advice-container').innerHTML = data.advice;
      }
      if (data.tasks) {
        document.getElementById('tasks-container').innerHTML = data.tasks;
      }
      if (data.diagram) {
        await renderDiagram(data.diagram);
      }
      regenerateBtn.textContent = '\u21BB Saved!';
      setTimeout(() => {
        regenerateBtn.textContent = '\u21BB Regenerate All';
      }, 2000);
    } else {
      alert(data.error || 'Failed to regenerate');
      regenerateBtn.textContent = '\u21BB Regenerate All';
    }
  } catch (err) {
    alert('Network error: ' + err.message);
    regenerateBtn.textContent = '\u21BB Regenerate All';
  } finally {
    regenerateBtn.disabled = false;
    regenerateBtn.classList.remove('loading');
  }
});

// ===================== FLOATING POPUPS =====================
const widgetMap = {
  'widget-btn-tasks': 'popup-tasks',
  'widget-btn-suggestions': 'popup-suggestions',
  'widget-btn-summary': 'popup-summary',
  'widget-btn-transcript': 'popup-transcript',
};

let activePopup = null;

Object.entries(widgetMap).forEach(([btnId, popupId]) => {
  const btn = document.getElementById(btnId);
  const popup = document.getElementById(popupId);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (activePopup === popupId) {
      // Close current
      popup.classList.add('hidden');
      btn.classList.remove('active');
      activePopup = null;
    } else {
      // Close any open popup
      closeAllPopups();
      // Open this one
      popup.classList.remove('hidden');
      btn.classList.add('active');
      activePopup = popupId;
    }
  });
});

function closeAllPopups() {
  Object.entries(widgetMap).forEach(([btnId, popupId]) => {
    document.getElementById(popupId).classList.add('hidden');
    document.getElementById(btnId).classList.remove('active');
  });
  activePopup = null;
}

// Close popup when clicking anywhere else
document.addEventListener('click', (e) => {
  if (!activePopup) return;
  const popup = document.getElementById(activePopup);
  const isInsidePopup = popup.contains(e.target);
  const isWidgetBtn = e.target.closest('.widget-btn');
  if (!isInsidePopup && !isWidgetBtn) {
    closeAllPopups();
  }
});
