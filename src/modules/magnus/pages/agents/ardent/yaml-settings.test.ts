import { describe, expect, it } from 'vitest';
import { readYamlValue, setYamlValue, YamlSettingsError } from './yaml-settings';

// The shape of profiles/assistant/config.yaml in ChefTaco/Ardent, comments included.
const CONFIG = `# Ardent profile, schema 1.
schema_version: 1
profile: assistant
execution:
  backend: llamacpp            # llamacpp | codex
  max_model_steps: 40
providers:
  llamacpp:
    # Any OpenAI-compatible server.
    base_url: \${ARDENT_LLAMA_BASE_URL}
    model: \${ARDENT_LLAMA_MODEL}
  codex:
    command: codex
    model: "gpt-x"
skills:
  directories: [skills]
channels:
  telegram:
    enabled: false
    token_env: TELEGRAM_BOT_TOKEN
    allowed_user_ids: []
    allowed_chat_ids:
      - 11
      - -22
    receive_mode: polling
  mattermost:
    enabled: false
`;

describe('readYamlValue', () => {
  it('reads scalars through nested mappings, without their comments', () => {
    expect(readYamlValue(CONFIG, ['execution', 'backend'])).toBe('llamacpp');
    expect(readYamlValue(CONFIG, ['providers', 'llamacpp', 'base_url'])).toBe('${ARDENT_LLAMA_BASE_URL}');
    expect(readYamlValue(CONFIG, ['providers', 'codex', 'model'])).toBe('gpt-x');
    expect(readYamlValue(CONFIG, ['channels', 'telegram', 'enabled'])).toBe(false);
  });
  it('reads flow and block lists', () => {
    expect(readYamlValue(CONFIG, ['channels', 'telegram', 'allowed_user_ids'])).toEqual([]);
    expect(readYamlValue(CONFIG, ['channels', 'telegram', 'allowed_chat_ids'])).toEqual(['11', '-22']);
  });
  it('does not take a same-named key from another section', () => {
    expect(readYamlValue(CONFIG, ['channels', 'mattermost', 'token_env'])).toBeNull();
    expect(readYamlValue(CONFIG, ['providers', 'codex', 'base_url'])).toBeNull();
  });
  it('gives null for what is absent', () => {
    expect(readYamlValue(CONFIG, ['nothing', 'here'])).toBeNull();
    expect(readYamlValue('', ['execution', 'backend'])).toBeNull();
  });
});

describe('setYamlValue', () => {
  it('changes only the value, and keeps comments and other lines byte for byte', () => {
    const next = setYamlValue(CONFIG, ['execution', 'backend'], 'codex');
    expect(next.split('\n')[4]).toBe('  backend: codex               # llamacpp | codex');
    const before = CONFIG.split('\n');
    next.split('\n').forEach((line, index) => {
      if (index !== 4) expect(line).toBe(before[index]);
    });
  });
  it('replaces a block list and leaves the following key in place', () => {
    const next = setYamlValue(CONFIG, ['channels', 'telegram', 'allowed_chat_ids'], [5, -6]);
    expect(next).toContain('    allowed_chat_ids: [5, -6]\n    receive_mode: polling');
    expect(next).not.toContain('- 11');
    expect(readYamlValue(next, ['channels', 'telegram', 'allowed_chat_ids'])).toEqual(['5', '-6']);
  });
  it('writes booleans and flow lists', () => {
    let next = setYamlValue(CONFIG, ['channels', 'telegram', 'enabled'], true);
    next = setYamlValue(next, ['channels', 'telegram', 'allowed_user_ids'], [1, 2]);
    expect(readYamlValue(next, ['channels', 'telegram', 'enabled'])).toBe(true);
    expect(readYamlValue(next, ['channels', 'telegram', 'allowed_user_ids'])).toEqual(['1', '2']);
    expect(readYamlValue(next, ['channels', 'mattermost', 'enabled'])).toBe(false);
  });
  it('round-trips strings that YAML would read as something else', () => {
    for (const value of ['true', 'null', '123', 'a: b', 'has # hash', '', 'http://127.0.0.1:8080', '${REF}', 'trailing:', "it's"]) {
      const next = setYamlValue(CONFIG, ['providers', 'llamacpp', 'model'], value);
      expect(readYamlValue(next, ['providers', 'llamacpp', 'model']) ?? '').toBe(value);
    }
  });
  it('adds a missing key under its section, and a missing section at the end', () => {
    const added = setYamlValue(CONFIG, ['channels', 'mattermost', 'token_env'], 'MM_TOKEN');
    expect(added).toContain('  mattermost:\n    enabled: false\n    token_env: MM_TOKEN\n');
    const section = setYamlValue('schema_version: 1\n', ['providers', 'codex', 'model'], 'x');
    expect(section).toBe('schema_version: 1\nproviders:\n  codex:\n    model: x\n');
    expect(readYamlValue(section, ['providers', 'codex', 'model'])).toBe('x');
  });
  it('refuses YAML it cannot edit safely rather than rewriting it', () => {
    const refused = [
      'channels: {telegram: {enabled: true}}\n',
      'execution:\n  backend: &b llamacpp\n',
      'execution:\n  backend: |\n    llamacpp\n',
      'execution:\n  backend: a\n  backend: b\n',
      'a: 1\n---\nb: 2\n---\nc: 3\n',
    ];
    const paths = [['channels', 'telegram', 'enabled'], ['execution', 'backend'], ['execution', 'backend'], ['execution', 'backend'], ['a']];
    refused.forEach((text, index) => expect(() => setYamlValue(text, paths[index]!, 'x'), text).toThrow(YamlSettingsError));
  });
  it('refuses to overwrite a section with a value', () => {
    expect(() => setYamlValue(CONFIG, ['channels', 'telegram'], 'x')).toThrow(YamlSettingsError);
  });
});
