// Deterministic OpenAI-compatible streaming model for the Studio end-to-end stack.
// It is the stack's only fixture: every other service is built from source. Replies are
// scripted per Studio role and request, streamed as chat-completion SSE chunks, and may
// call Ardent's mission tools (team_ask_user, team_propose_decision, team_handoff,
// artifact_write, document_render). Synthetic content only.
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const MODEL = process.env.MODEL_ID || 'studio-fixture';
const PORT = Number(process.env.PORT || 8080);
const CHUNK_DELAY_MS = Number(process.env.CHUNK_DELAY_MS || 35);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = [];

const svgMap = ford => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
<rect width="800" height="500" fill="#efe6d0"/>
<path d="M0 360 C180 300 320 420 520 340 S760 300 800 320 L800 500 L0 500 Z" fill="#6f8f6a" id="swamp"/>
<path d="M60 80 L200 40 L300 120 L180 190 Z" fill="#9a8b78" id="cinderwatch-heights"/>
<circle cx="560" cy="150" r="70" fill="#b9d3e3" id="glowmere"/>
<path d="M120 470 C260 330 420 260 700 90" stroke="#7a4b2a" stroke-width="6" fill="none" stroke-dasharray="12 8" id="ember-road"/>
${ford ? '<rect x="400" y="330" width="60" height="18" fill="#c8a165" stroke="#5b3d1f" id="ford"/><text x="400" y="322" font-size="16" font-family="serif">Old Ford</text>' : ''}
<text x="40" y="420" font-size="22" font-family="serif">Ashen Fen</text>
<text x="70" y="70" font-size="20" font-family="serif">Cinderwatch Heights</text>
<text x="510" y="155" font-size="20" font-family="serif">Glowmere</text>
<text x="560" y="40" font-size="26" font-family="serif">Emberfall</text>
</svg>`;

const adventureMarkdown = short => `# Emberfall One-Shot

## Act 1: The Ember Road
The party escorts a lantern caravan along the old ember road toward Cinderwatch Heights.

## Act 2: Ashen Fen
Fog rolls in from the fen and the caravan's lanterns begin to dim one by one.

## Act 3: Glowmere
The source of the dimming waits beneath the still water of Glowmere.

${short ? 'The finale resolves at the shore in one short scene.' : 'The finale has three stages: the drowned bell, the lantern bargain and the long walk home across the fen while the fog lifts and the caravan counts its lanterns, its people and its debts one last time before dawn.'}
`;

const researchMarkdown = revised => `# Battery Recycling Brief

## Summary
Hydrometallurgical recovery returns most lithium, cobalt and nickel from spent cells.${revised ? ' Recovery rates depend on the feedstock chemistry [S2].' : ''}

## Findings
1. Collection, not processing capacity, limits recycled supply today [S1].
2. Direct recycling keeps cathode structure and may cut energy use [S3].

## Sources
- [S1] Synthetic Source One, example.com/recycling-collection
- [S2] Synthetic Source Two, example.com/recovery-rates
- [S3] Synthetic Source Three, example.com/direct-recycling
`;

// A noise PNG of about 3 MiB, generated once, so a > 2 MiB artifact crosses every hop.
let largePng;
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return ~crc >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function largePngBase64() {
  if (largePng) return largePng;
  const width = 1024, height = 1024;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; raw[i] = i % (width * 3 + 1) === 0 ? 0 : seed >> 16; }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw, { level: 0 })), pngChunk('IEND', Buffer.alloc(0))]);
  largePng = png.toString('base64');
  return largePng;
}

const text = value => ({ text: value });
const tool = (name, args) => ({ tool: name, args });

// Each rule: the role it serves, a test on the current request, and its steps. A step
// is one model response; a tool step's result comes back before the next step.
const rules = [
  { role: 'worldbuilder', match: /three region names/i, steps: [text('Three region names for Emberfall: **Ashen Fen**, a drowned marsh of grey reeds; **Cinderwatch Heights**, the ridge where the old signal fires burned; and **Glowmere**, a still lake that shines at night. The ember road links all three, and every name keeps the ash-and-light theme of the brief.')] },
  { role: 'story_lead', match: /outline the adventure/i, steps: [tool('team_ask_user', { question: 'Which tone should the one-shot take?', options: ['Hopeful adventure', 'Grim and tense'] })] },
  { role: 'story_lead', match: /answered .*tone/is, steps: [
    tool('team_propose_decision', { title: 'Adventure outline', statement: 'Three acts: the Ember Road, Ashen Fen and Glowmere, in a hopeful tone.', rationale: 'Matches the brief and the chosen tone.' }),
    tool('team_handoff', { to_role: 'worldbuilder', objective: 'Write the adventure text from the outline.' }),
    text('Outline, in a hopeful tone:\n1. **The Ember Road**: escort the lantern caravan.\n2. **Ashen Fen**: the lanterns dim in the fog.\n3. **Glowmere**: bargain with what waits under the lake.\nI proposed this outline as a decision and asked the Worldbuilder for the adventure text.')] },
  { role: 'cartographer', match: /^Revision request/m, steps: [
    tool('artifact_write', { name: 'region-map.svg', mime: 'image/svg+xml', text: svgMap(true) }),
    text('Revised the region map: the swamp now has the Old Ford.')] },
  { role: 'cartographer', match: /poster/i, steps: [
    tool('artifact_write', { name: 'map-poster.png', mime: 'image/png', base64: '@large-png' }),
    text('The print poster of the map is attached.')] },
  { role: 'cartographer', match: /map/i, steps: [
    tool('artifact_write', { name: 'region-map.svg', mime: 'image/svg+xml', text: svgMap(false) }),
    tool('team_handoff', { to_role: 'worldbuilder', objective: 'Name the swamp crossing on the region map.' }),
    text('The region map of Emberfall is ready for review.')] },
  { role: 'worldbuilder', match: /^Revision request/m, steps: [
    tool('document_render', { source_markdown: adventureMarkdown(true), format: 'pdf', name: 'adventure-text.pdf' }),
    text('Shortened the finale in the adventure text.')] },
  { role: 'worldbuilder', match: /adventure text/i, steps: [
    tool('document_render', { source_markdown: adventureMarkdown(false), format: 'pdf', name: 'adventure-text.pdf' }),
    tool('artifact_write', { name: 'adventure-notes.md', mime: 'text/markdown', text: adventureMarkdown(false) }),
    tool('team_handoff', { to_role: 'story_lead', objective: 'Review the adventure text before layout.' }),
    text('The adventure text is rendered as a PDF, with the Markdown notes beside it.')] },
  { role: 'lead_researcher', match: /^Revision request/m, steps: [
    tool('artifact_write', { name: 'research-report.md', mime: 'text/markdown', text: researchMarkdown(true) }),
    text('Revised the report: the summary now cites recovery rates [S2].')] },
  { role: 'lead_researcher', match: /sourced summary/i, steps: [
    tool('artifact_write', { name: 'research-report.md', mime: 'text/markdown', text: researchMarkdown(false) }),
    tool('team_handoff', { to_role: 'fact_checker', objective: 'Check the claims in the research report.' }),
    text('Sourced summary: collection limits recycled supply [S1], and direct recycling may cut energy use [S3]. The full report is attached and the Fact Checker is checking it.')] },
  { role: 'fact_checker', match: /./, steps: [text('Checked the research report: claims [S1] and [S3] match their sources; the summary sentence on recovery needs a citation.')] },
];

const markers = /^(Message for you from .*|.* answered ".*|Revision request: .*|Review request: .*|Assignment: .*|Discussion question: .*)$/m;
function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i;
  return -1;
}
function content(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) return message.content.map(part => part.text ?? '').join('');
  return '';
}

function plan(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const index = lastUser(messages);
  const prompt = index >= 0 ? content(messages[index]) : '';
  const role = /role key "([a-z0-9_]+)"/.exec(prompt)?.[1] ?? null;
  const at = prompt.search(markers);
  const request = at >= 0 ? prompt.slice(at) : prompt.slice(-2000);
  const step = messages.slice(index + 1).filter(message => message.role === 'assistant'
    && !(message.tool_calls ?? []).every(call => call.function?.name === 'mission_context_item')).length;
  const rule = rules.find(item => item.role === role && item.match.test(request));
  const offered = new Set((body.tools ?? []).map(entry => entry.function?.name));
  // A tool the agent is not given is a step the model would not take.
  const steps = (rule?.steps ?? [text(role ? `Noted. (${role})` : 'Noted.')]).filter(item => !item.tool || offered.has(item.tool));
  const next = steps[step] ?? text('Done.');
  log.push({ at: new Date().toISOString(), role, step, rule: rule ? rules.indexOf(rule) : null, request: request.slice(0, 200), reply: next.tool ?? 'text', tools: [...offered] });
  if (log.length > 500) log.shift();
  if (next.tool === 'artifact_write' && next.args.base64 === '@large-png') return tool('artifact_write', { ...next.args, base64: largePngBase64() });
  return next;
}

function pieces(value, size) {
  const out = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out.length ? out : [''];
}

async function stream(res, reply) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const send = choice => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: MODEL, choices: [choice] })}\n\n`);
  send({ index: 0, delta: { role: 'assistant' }, finish_reason: null });
  if (reply.text !== undefined) {
    for (const word of reply.text.match(/\S+\s*/g) ?? ['']) { send({ index: 0, delta: { content: word }, finish_reason: null }); await sleep(CHUNK_DELAY_MS); }
    send({ index: 0, delta: {}, finish_reason: 'stop' });
  } else {
    const callId = `call_${Math.random().toString(36).slice(2, 12)}`;
    const args = JSON.stringify(reply.args);
    send({ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: reply.tool, arguments: '' } }] }, finish_reason: null });
    for (const part of pieces(args, args.length > 100_000 ? 65_536 : 48)) {
      send({ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: part } }] }, finish_reason: null });
      if (args.length <= 100_000) await sleep(5);
    }
    send({ index: 0, delta: {}, finish_reason: 'tool_calls' });
  }
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: MODEL, choices: [], usage: { prompt_tokens: 100, completion_tokens: 50 } })}\n\n`);
  res.end('data: [DONE]\n\n');
}

function complete(res, reply) {
  const message = reply.text !== undefined ? { role: 'assistant', content: reply.text }
    : { role: 'assistant', content: null, tool_calls: [{ id: `call_${Date.now().toString(36)}`, type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: `chatcmpl-${Date.now().toString(36)}`, object: 'chat.completion', model: MODEL, choices: [{ index: 0, message, finish_reason: reply.text !== undefined ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://model');
    if (req.method === 'GET' && url.pathname === '/health') return void res.end('ok');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'fixture', meta: { n_ctx: 65536 } }] }));
    }
    if (req.method === 'GET' && url.pathname === '/props') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ default_generation_settings: { n_ctx: 65536 }, chat_template_caps: { supports_tools: true } }));
    }
    if (req.method === 'GET' && url.pathname === '/fixture/log') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify(log));
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readJson(req);
      // A scripted provider failure, for the blocked state: Ardent does not retry a 500.
      const last = [...(body.messages ?? [])].reverse().find(message => message.role === 'user');
      if (/fail this turn/i.test(content(last ?? {}))) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return void res.end(JSON.stringify({ error: { message: 'scripted fixture failure' } }));
      }
      const reply = plan(body);
      return void (body.stream === false ? complete(res, reply) : await stream(res, reply));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'fixture error' }));
  }
});
server.listen(PORT, '0.0.0.0', () => process.stdout.write(`studio fixture model ${MODEL} on :${PORT}\n`));
