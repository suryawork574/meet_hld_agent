import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

let previousDiagram = '';

const DIAGRAM_PROMPT = `You are an expert system design architect. Generate a Mermaid.js flowchart from the meeting transcript below.

Rules:
- Output ONLY valid Mermaid.js code. No markdown fences, no explanation, no comments.
- Start with: flowchart LR
- Use subgraphs to group related components. Example:
  subgraph Data Layer
    db1[MySQL Database]
    db2[Redis Cache]
  end
- IMPORTANT node ID prefixes — you MUST use these prefixes:
  - db_ for databases (e.g., db_mysql, db_redis, db_mongo)
  - svc_ for services/APIs (e.g., svc_auth, svc_order, svc_gateway)
  - q_ for queues/topics/streams (e.g., q_events, q_notifications)
  - ext_ for external/client-facing (e.g., ext_client, ext_cdn, ext_lb)
  - cache_ for caches (e.g., cache_redis, cache_memcached)
- Node shapes — use ONLY these:
  - db_x[(Database Name)] for databases (cylinder)
  - svc_x[Service Name] for services (rectangle)
  - q_x([Queue Name]) for queues/topics (stadium)
  - ext_x>Client Name] for external (asymmetric)
  - cache_x{{Cache Name}} for caches (hexagon)
- Edge labels with arrows: A -->|writes| B or A -.->|async| B for async flows
- Do NOT use fa: icons, :::className, or style/classDef lines — styles are added automatically
- Keep it clean and easy to read
- If updating a previous diagram, preserve existing structure and add new elements

{PREVIOUS_DIAGRAM}

Meeting transcript:
{TRANSCRIPT}

Generate the Mermaid.js diagram:`;

const SUMMARY_PROMPT = `You are a meeting note-taker. Based on this transcript from a system design discussion, provide a concise summary in HTML format.

Structure it as:
<div class="summary-content">
  <div class="summary-section">
    <div class="summary-label">Topic</div>
    <div class="summary-text">[1-2 sentence overview of what's being discussed]</div>
  </div>
  <div class="summary-section">
    <div class="summary-label">Key Components</div>
    <ul>[list each component/service/database mentioned as <li> items]</ul>
  </div>
  <div class="summary-section">
    <div class="summary-label">Data Flow</div>
    <div class="summary-text">[brief description of how data moves between components]</div>
  </div>
</div>

Rules:
- Output ONLY the HTML, nothing else
- Be concise — max 2-3 bullet points per section
- Only include sections that have content from the transcript
- Use plain, clear language

Transcript:
{TRANSCRIPT}`;

export async function generateDiagram(transcript: string, suggestion?: string): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });

    let prompt = DIAGRAM_PROMPT
      .replace('{PREVIOUS_DIAGRAM}',
        previousDiagram
          ? `Previous diagram (preserve and extend):\n${previousDiagram}`
          : 'No previous diagram exists yet.'
      )
      .replace('{TRANSCRIPT}', transcript);

    if (suggestion) {
      prompt += `\n\nUser's specific request for this update:\n${suggestion}\nIncorporate the above suggestion into the diagram while keeping existing components.`;
    }

    logger.info('Generating Mermaid diagram from transcript...');

    const result = await model.generateContent(prompt);
    const response = result.response;
    let mermaidCode = response.text().trim();

    // Clean up any markdown fences if present
    mermaidCode = mermaidCode
      .replace(/^```mermaid\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Remove common invalid syntax that Gemini may produce
    mermaidCode = mermaidCode
      .replace(/^%%.*$/gm, '')                    // Remove comments
      .replace(/:::[\w-]+/g, '')                   // Remove :::className
      .replace(/^(\s*style\s+.*$)/gm, '')          // Remove style lines
      .replace(/^(\s*classDef\s+.*$)/gm, '')       // Remove classDef lines
      .replace(/^(\s*class\s+.*$)/gm, '')          // Remove class assignment lines
      .replace(/fa:fa-[\w-]+\s*/g, '')             // Remove fa icons
      .replace(/\n{3,}/g, '\n\n')                  // Collapse blank lines
      .trim();

    // Inject color styles based on node ID prefixes
    mermaidCode = injectStyles(mermaidCode);

    logger.info({ mermaidCode: mermaidCode.substring(0, 800) }, 'Styled Mermaid code');

    // Basic validation
    if (!isValidMermaidSyntax(mermaidCode)) {
      logger.warn({ mermaidCode: mermaidCode.substring(0, 500) }, 'Invalid Mermaid syntax generated');
      return previousDiagram || null;
    }

    previousDiagram = mermaidCode;
    logger.info({ diagramLength: mermaidCode.length }, 'Diagram generated successfully');
    return mermaidCode;
  } catch (err) {
    logger.error({ err }, 'Failed to generate diagram');
    return previousDiagram || null;
  }
}

export async function generateSummary(transcript: string): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const prompt = SUMMARY_PROMPT.replace('{TRANSCRIPT}', transcript);

    logger.info('Generating summary from transcript...');
    const result = await model.generateContent(prompt);
    let html = result.response.text().trim();

    // Clean up markdown fences if present
    html = html.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim();

    logger.info('Summary generated successfully');
    return html;
  } catch (err) {
    logger.error({ err }, 'Failed to generate summary');
    return null;
  }
}

const ADVICE_PROMPT = `You are a senior system design architect reviewing a design discussion. Based on the transcript and the current system design, provide actionable design advice.

Output ONLY an HTML unordered list of advice points. Each point should be a concrete, specific suggestion — not generic. Focus on:
- Missing components that would improve reliability (e.g., dead letter queues, retry mechanisms, circuit breakers)
- Scalability concerns (e.g., single points of failure, bottlenecks)
- Data consistency issues (e.g., eventual consistency gaps, missing idempotency)
- Security gaps (e.g., missing auth between services, unencrypted data in transit)
- Monitoring/observability gaps
- Better alternatives for mentioned technologies if applicable

Rules:
- Output ONLY <li> elements wrapped in a <ul>, nothing else
- Max 5 points, min 1
- Each point should be 1-2 sentences max
- Be specific to the design being discussed, not generic advice
- Prefix each point with a category in bold: <strong>Reliability:</strong>, <strong>Scalability:</strong>, <strong>Security:</strong>, <strong>Observability:</strong>, <strong>Performance:</strong>, etc.
- If the design looks solid, still suggest improvements — there's always something

Current diagram:
{DIAGRAM}

Meeting transcript:
{TRANSCRIPT}`;

export async function generateAdvice(transcript: string): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const prompt = ADVICE_PROMPT
      .replace('{DIAGRAM}', previousDiagram || 'No diagram yet')
      .replace('{TRANSCRIPT}', transcript);

    logger.info('Generating design advice...');
    const result = await model.generateContent(prompt);
    let html = result.response.text().trim();

    html = html.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim();

    logger.info('Design advice generated successfully');
    return html;
  } catch (err) {
    logger.error({ err }, 'Failed to generate advice');
    return null;
  }
}

function injectStyles(code: string): string {
  // Extract all node IDs from the diagram
  const nodeIds = new Set<string>();
  // Match node definitions like: db_mysql[...], svc_auth[...], q_events([...]), etc.
  const nodePattern = /\b((?:db|svc|q|ext|cache)_[\w]+)/g;
  let match;
  while ((match = nodePattern.exec(code)) !== null) {
    nodeIds.add(match[1]);
  }

  if (nodeIds.size === 0) return code;

  const prefixStyles: Record<string, string> = {
    db_: 'fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1',
    svc_: 'fill:#ede7f6,stroke:#7e57c2,stroke-width:2px,color:#311b92',
    q_: 'fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:#e65100',
    ext_: 'fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20',
    cache_: 'fill:#fce4ec,stroke:#c62828,stroke-width:2px,color:#b71c1c',
  };

  const styleLines: string[] = [];
  for (const id of nodeIds) {
    for (const [prefix, style] of Object.entries(prefixStyles)) {
      if (id.startsWith(prefix)) {
        styleLines.push(`    style ${id} ${style}`);
        break;
      }
    }
  }

  if (styleLines.length === 0) return code;

  return code + '\n' + styleLines.join('\n');
}

const TASKS_PROMPT = `You are a senior engineering project manager. Based on the system design discussion transcript, break down the design into actionable development tasks in Jira-style format.

Output ONLY an HTML list of task cards using this exact structure:

<div class="task-card">
  <div class="task-header">
    <span class="task-id">TASK-{N}</span>
    <span class="task-priority priority-{high|medium|low}">{High|Medium|Low}</span>
  </div>
  <div class="task-name">{Task Title}</div>
  <div class="task-field">
    <div class="task-field-label">Description</div>
    <div class="task-field-value">{2-3 sentence description of the implementation work}</div>
  </div>
  <div class="task-field">
    <div class="task-field-label">Acceptance Criteria</div>
    <ul class="task-ac">
      <li>{criterion 1}</li>
      <li>{criterion 2}</li>
      <li>{criterion 3}</li>
    </ul>
  </div>
  <div class="task-field">
    <div class="task-field-label">Estimated Timeline</div>
    <div class="task-field-value">{estimated time for AI code generation, e.g. "~2 hours with AI-assisted code generation" or "~30 mins with AI scaffolding"}</div>
  </div>
</div>

Rules:
- Output ONLY the HTML task cards, nothing else. No markdown fences.
- Generate 3-8 tasks depending on the complexity discussed
- Order tasks by priority (High first, then Medium, then Low)
- Task IDs should be sequential: TASK-1, TASK-2, etc.
- Each task should represent a concrete, implementable unit of work
- Acceptance criteria should be specific and testable (2-4 per task)
- Timelines should reflect AI-assisted code generation speed (faster than manual):
  - Simple CRUD/boilerplate: ~15-30 mins
  - Service with business logic: ~1-2 hours
  - Complex integration/infrastructure: ~2-4 hours
  - Full feature with tests: ~3-6 hours
- Include tasks for: services, databases, APIs, infrastructure, testing, monitoring
- Be specific to the architecture discussed, not generic

Current system design diagram:
{DIAGRAM}

Meeting transcript:
{TRANSCRIPT}`;

export async function generateTasks(transcript: string): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const prompt = TASKS_PROMPT
      .replace('{DIAGRAM}', previousDiagram || 'No diagram yet')
      .replace('{TRANSCRIPT}', transcript);

    logger.info('Generating task breakdown from transcript...');
    const result = await model.generateContent(prompt);
    let html = result.response.text().trim();

    html = html.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim();

    logger.info('Task breakdown generated successfully');
    return html;
  } catch (err) {
    logger.error({ err }, 'Failed to generate tasks');
    return null;
  }
}

function isValidMermaidSyntax(code: string): boolean {
  if (!code || code.length < 10) return false;

  const validStarts = [
    'flowchart', 'graph', 'sequenceDiagram', 'classDiagram',
    'erDiagram', 'stateDiagram', 'gantt', 'pie', 'gitgraph',
    'C4Context', 'C4Container', 'C4Component', 'C4Deployment',
    'mindmap', 'timeline', 'journey', 'block-beta',
  ];

  const firstLine = code.split('\n')[0].trim().toLowerCase();
  return validStarts.some(start => firstLine.startsWith(start.toLowerCase()));
}

export function getPreviousDiagram(): string {
  return previousDiagram;
}

export function resetDiagram() {
  previousDiagram = '';
}
