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

socket.on('summary:update', (summaryHtml) => {
  summaryContainer.innerHTML = summaryHtml;
});

socket.on('advice:update', (adviceHtml) => {
  const advicePanel = document.getElementById('advice-panel');
  const adviceContainer = document.getElementById('advice-container');
  if (adviceHtml) {
    adviceContainer.innerHTML = adviceHtml;
    advicePanel.classList.remove('hidden');
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

  mermaidSource.textContent = mermaidCode;

  try {
    renderCounter++;
    const id = `mermaid-diagram-${renderCounter}`;
    const { svg } = await mermaid.render(id, mermaidCode);
    mermaidOutput.innerHTML = svg;
    mermaidOutput.classList.remove('mermaid-placeholder');

    // Auto-fit after render
    requestAnimationFrame(() => {
      document.getElementById('zoom-fit').click();
    });
  } catch (err) {
    console.error('Mermaid render error:', err);
    mermaidOutput.innerHTML = `<div class="mermaid-placeholder">Diagram rendering error. Check Mermaid syntax.</div>`;
  }
});

// UI handlers
resetBtn.addEventListener('click', () => {
  if (confirm('Reset the current diagram?')) {
    socket.emit('diagram:reset');
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
