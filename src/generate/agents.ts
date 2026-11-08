export interface AgentSource {
  role: string;
  name: string;
  description: string;
  tools?: string;
  body: string;
}

export function parseAgentSource(role: string, md: string): AgentSource {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) throw new Error(`Agent source "${role}" is missing frontmatter`);
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!fm.name) throw new Error(`Agent source "${role}" is missing name`);
  if (!fm.description) throw new Error(`Agent source "${role}" is missing description`);
  return {
    role,
    name: fm.name,
    description: fm.description,
    ...(fm.tools ? { tools: fm.tools } : {}),
    body: m[2].trim(),
  };
}

export function renderClaudeAgent(src: AgentSource, model: string): string {
  const lines = ['---', `name: ${src.name}`, `description: ${src.description}`];
  if (src.tools) lines.push(`tools: ${src.tools}`);
  if (model !== 'inherit') lines.push(`model: ${model}`);
  lines.push('---', '', src.body, '');
  return lines.join('\n');
}

function basicString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function multilineBasic(s: string): string {
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '\\"\\"\\"')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"""\n${esc}\n"""`;
}

export function renderCodexAgent(src: AgentSource, model: string, effort?: string): string {
  const instructions = src.body.includes("'''") ? multilineBasic(src.body) : `'''\n${src.body}\n'''`;
  const lines = [`name = ${basicString(src.name)}`, `description = ${basicString(src.description)}`];
  if (model !== 'inherit') lines.push(`model = ${basicString(model)}`);
  if (effort) lines.push(`model_reasoning_effort = ${basicString(effort)}`);
  lines.push(`developer_instructions = ${instructions}`, '');
  return lines.join('\n');
}
