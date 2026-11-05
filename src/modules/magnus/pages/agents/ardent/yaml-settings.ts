// The provider and channel forms change a few values inside a profile's YAML and must leave the rest,
// comments included, as it was. The old console used the `yaml` package for that. This module has no
// dependency on it: it edits only plain block mappings, and refuses anything else, so the operator
// goes to the Configuration tab instead of having a document rewritten wrongly. The node validates
// the result before saving.

export class YamlSettingsError extends Error {}

type Line = { indent: number; blank: boolean };
const describe = (line: string): Line => {
  const trimmed = line.trim();
  return { indent: line.length - line.trimStart().length, blank: trimmed === '' || trimmed.startsWith('#') };
};
const KEY = /^(\s*)(?:"([^"]+)"|'([^']+)'|([^\s:#'"[\]{}&*!|>-][^\s:#]*)):(\s.*)?$/;

function keyOf(line: string): string | null {
  const match = KEY.exec(line.replace(/\r$/, ''));
  return match ? (match[2] ?? match[3] ?? match[4] ?? null) : null;
}

/** Split `value # comment` where the # is not inside quotes. */
function splitComment(rest: string): { value: string; comment: string } {
  let quote = '';
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index]!;
    if (quote) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '#' && (index === 0 || /\s/.test(rest[index - 1]!))) return { value: rest.slice(0, index).trim(), comment: rest.slice(index).trimEnd() };
  }
  return { value: rest.trim(), comment: '' };
}

function assertSupported(lines: readonly string[]): void {
  const documents = lines.filter((line) => /^---(\s|$)/.test(line)).length;
  if (documents > 1 || lines.some((line) => /^\.\.\.\s*$/.test(line) || /^\t/.test(line))) throw new YamlSettingsError('This configuration uses YAML the form cannot edit.');
}

/** The lines [start, end) under a key at `from`, including a sequence at the key's own indent. */
function blockEnd(lines: readonly string[], from: number, indent: number): number {
  let end = lines.length;
  for (let index = from + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const info = describe(line);
    if (info.blank) continue;
    if (info.indent < indent || (info.indent === indent && !line.trimStart().startsWith('- '))) {
      end = index;
      break;
    }
  }
  // Blank lines and comments before the next key belong to that key.
  while (end > from + 1 && describe(lines[end - 1]!).blank) end -= 1;
  return end;
}

interface Found {
  line: number;
  indent: number;
  end: number;
}

function findKey(lines: readonly string[], start: number, end: number, key: string): Found | null {
  let childIndent = -1;
  let found: Found | null = null;
  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    const info = describe(line);
    if (info.blank || /^---(\s|$)/.test(line)) continue;
    if (childIndent < 0) childIndent = info.indent;
    if (info.indent !== childIndent) continue;
    if (keyOf(line) !== key) continue;
    if (found) throw new YamlSettingsError(`This configuration repeats the key ${key}.`);
    found = { line: index, indent: info.indent, end: blockEnd(lines, index, info.indent) };
  }
  return found;
}

function locate(lines: readonly string[], path: readonly string[]): Found | null {
  let start = 0;
  let end = lines.length;
  let found: Found | null = null;
  for (const [depth, key] of path.entries()) {
    found = findKey(lines, start, end, key);
    if (!found) return null;
    if (depth < path.length - 1) {
      const inline = splitComment(lines[found.line]!.slice(lines[found.line]!.indexOf(':') + 1)).value;
      if (inline && inline !== '~' && inline !== 'null') throw new YamlSettingsError(`This configuration writes ${key} in a form the form cannot edit.`);
    }
    start = found.line + 1;
    end = found.end;
  }
  return found;
}

function parseScalar(raw: string): string | boolean | null {
  if (raw === '' || raw === '~' || raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      throw new YamlSettingsError('This configuration has a quoted value the form cannot read.');
    }
  }
  if (raw.startsWith("'")) return raw.slice(1, raw.endsWith("'") ? -1 : undefined).replaceAll("''", "'");
  if (/^[&*!|>{]/.test(raw)) throw new YamlSettingsError('This configuration uses YAML the form cannot edit.');
  return raw;
}

/** A string, a boolean, a list of strings, or null when the key is absent or empty. */
export function readYamlValue(text: string, path: readonly string[]): string | boolean | string[] | null {
  const lines = text.split('\n');
  assertSupported(lines);
  const found = locate(lines, path);
  if (!found) return null;
  const line = lines[found.line]!;
  const { value } = splitComment(line.slice(line.indexOf(':') + 1));
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new YamlSettingsError('This configuration uses a list the form cannot edit.');
    return value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean).map((item) => String(parseScalar(item)));
  }
  if (value !== '') return parseScalar(value);
  const items = lines.slice(found.line + 1, found.end).filter((item) => !describe(item).blank);
  if (items.length === 0) return null;
  if (items.every((item) => item.trimStart().startsWith('- '))) return items.map((item) => String(parseScalar(splitComment(item.trimStart().slice(2)).value)));
  throw new YamlSettingsError('This configuration holds a mapping where the form expects a value.');
}

function formatString(value: string): string {
  const plain = /^[A-Za-z_$/.][A-Za-z0-9_$./:{}@+-]*$/.test(value) && !value.endsWith(':') && !/^(?:true|false|null|yes|no|on|off|\.\d.*)$/i.test(value);
  return plain ? value : JSON.stringify(value);
}
const format = (value: string | boolean | readonly number[]): string => (typeof value === 'boolean' ? String(value) : typeof value === 'string' ? formatString(value) : `[${value.join(', ')}]`);

function insert(lines: string[], path: readonly string[], value: string): void {
  // Find the deepest parent that exists, then write the missing keys under it.
  let depth = path.length - 1;
  let parent: Found | null = null;
  while (depth > 0) {
    parent = locate(lines, path.slice(0, depth));
    if (parent) break;
    depth -= 1;
  }
  const missing = path.slice(depth);
  const first = parent ? lines.slice(parent.line + 1, parent.end).find((line) => !describe(line).blank) : undefined;
  const indent = !parent ? 0 : first ? describe(first).indent : parent.indent + 2;
  let at = parent ? parent.end : lines.length;
  if (!parent) while (at > 0 && lines[at - 1]!.trim() === '') at -= 1;
  const added = missing.map((key, index) => `${' '.repeat(indent + index * 2)}${key}:${index === missing.length - 1 ? ` ${value}` : ''}`);
  lines.splice(at, 0, ...added);
}

/** The document with one value replaced or added. Everything else stays byte for byte. */
export function setYamlValue(text: string, path: readonly string[], value: string | boolean | readonly number[]): string {
  const lines = text.split('\n');
  assertSupported(lines);
  const found = locate(lines, path);
  const written = format(value);
  if (!found) {
    insert(lines, path, written);
    return lines.join('\n');
  }
  const line = lines[found.line]!;
  const colon = line.indexOf(':', line.length - line.trimStart().length);
  const { value: current, comment } = splitComment(line.slice(colon + 1));
  if (/^[|>&*!{]/.test(current) || (current.startsWith('[') && !current.endsWith(']'))) throw new YamlSettingsError('This configuration uses YAML the form cannot edit.');
  const body = lines.slice(found.line + 1, found.end).filter((item) => !describe(item).blank);
  if (current === '' && body.some((item) => !item.trimStart().startsWith('- '))) throw new YamlSettingsError('This configuration holds a mapping where the form expects a value.');
  // Keep the column of a trailing comment when the new value fits before it.
  const padding = comment ? (/\s+#/.exec(line.slice(colon + 1))?.[0].length ?? 2) - 1 : 0;
  const pad = comment ? ' '.repeat(Math.max(1, padding + current.length - written.length)) : '';
  lines[found.line] = `${line.slice(0, colon + 1)} ${written}${comment ? `${pad}${comment}` : ''}`;
  if (current === '') lines.splice(found.line + 1, found.end - found.line - 1);
  return lines.join('\n');
}
