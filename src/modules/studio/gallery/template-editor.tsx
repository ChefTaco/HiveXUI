import { useEffect, useState } from 'react';
import { Button, Drawer, Field, Select, TextArea, TextInput } from '@ui';
import { STAGES } from '@contracts/ardentstudio.generated';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey } from '../api/client';
import { createTemplate, createTemplateVersion, type TemplateDetail, type TemplateVersion } from '../api/endpoints';
import { listFromText, STAGE_LABEL, type SkillRef } from '../team/model';

type Body = TemplateVersion['body'];
type AgentBody = Extract<TemplateVersion, { kind: 'agent' }>['body'];
type TeamBody = Extract<TemplateVersion, { kind: 'team' }>['body'];
const INTEGRATIONS = ['hivemem', 'hiveskills', 'emberpath'] as const;
const INTEGRATION_LABEL: Record<(typeof INTEGRATIONS)[number], string> = { hivemem: 'HiveMem', hiveskills: 'HiveSkills', emberpath: 'Emberpath' };

const skillsText = (skills: readonly SkillRef[]) => skills.map((skill) => `${skill.kind === 'hiveskills' ? 'hiveskills:' : ''}${skill.ref}`).join('\n');
/** One skill per line; a `hiveskills:` prefix names a HiveSkills catalog skill. */
export const skillsFromText = (text: string): SkillRef[] =>
  listFromText(text, 50).map((line) => (line.startsWith('hiveskills:') ? { kind: 'hiveskills' as const, ref: line.slice('hiveskills:'.length).trim() } : { kind: 'local' as const, ref: line }));

/**
 * Customize a template as its next version, or duplicate it as a new variant. Versions are
 * immutable: saving never changes what a project already pinned.
 */
export function TemplateEditor({ template, base, mode, onClose, onSaved }: { template: TemplateDetail; base: TemplateVersion; mode: 'version' | 'variant'; onClose: () => void; onSaved: (saved: TemplateDetail) => void }) {
  const [body, setBody] = useState<Body>(() => structuredClone(base.body));
  const [changelog, setChangelog] = useState(mode === 'variant' ? `Variant of ${template.name} v${base.version}` : '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    const copy = structuredClone(base.body);
    if (mode === 'variant') copy.name = `${copy.name} variant`.slice(0, 200);
    setBody(copy);
  }, [base, mode]);
  const set = (patch: Partial<Body>) => setBody((current) => ({ ...current, ...patch }) as Body);
  const agent = base.kind === 'agent' ? (body as AgentBody) : null;
  const team = base.kind === 'team' ? (body as TeamBody) : null;

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const saved =
        mode === 'version'
          ? await createTemplateVersion(template.id, { base_version: template.latest_version, changelog: changelog.trim(), body }, idempotencyKey())
          : await createTemplate(base.kind === 'agent' ? { kind: 'agent', changelog: changelog.trim() || 'Initial version', body: body as AgentBody } : { kind: 'team', changelog: changelog.trim() || 'Initial version', body: body as TeamBody }, idempotencyKey());
      onSaved(saved);
    } catch (error) {
      setFailure(errorMessage(error, 'The template could not be saved'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title={mode === 'version' ? `Customize ${template.name}` : `Duplicate ${template.name}`}
      eyebrow={mode === 'version' ? `New version ${template.latest_version + 1}, from v${base.version}` : 'New template'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!body.name.trim() || (mode === 'version' && !changelog.trim())} onClick={() => void submit()}>
            {mode === 'version' ? 'Save new version' : 'Save variant'}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <TextInput value={body.name} maxLength={200} onChange={(name) => set({ name })} />
      </Field>
      <Field label="Category">
        <TextInput value={body.category} maxLength={64} onChange={(category) => set({ category })} />
      </Field>
      <Field label="Purpose">
        <TextArea value={body.purpose} rows={3} maxLength={2000} onChange={(purpose) => set({ purpose })} />
      </Field>
      <Field label="Example uses" hint="One per line">
        <TextArea value={body.example_uses.join('\n')} rows={2} onChange={(text) => set({ example_uses: listFromText(text, 20) })} />
      </Field>
      {agent ? (
        <>
          <Field label="SOUL.md" hint="Character and values">
            <TextArea className="font-mono text-xs" value={agent.soul_md} rows={8} maxLength={65_536} onChange={(soul_md) => set({ soul_md } as Partial<Body>)} />
          </Field>
          <Field label="IDENTITY.md" hint="Role and way of working">
            <TextArea className="font-mono text-xs" value={agent.identity_md} rows={8} maxLength={65_536} onChange={(identity_md) => set({ identity_md } as Partial<Body>)} />
          </Field>
          <Field label="Skills" hint="One per line; prefix hiveskills: for a catalog skill">
            <TextArea value={skillsText(agent.skills)} rows={3} onChange={(text) => set({ skills: skillsFromText(text) } as Partial<Body>)} />
          </Field>
          <Field label="Model hint" hint="An Emberpath alias or a model name. Never a key or a URL with credentials.">
            <TextInput value={agent.model_hint ?? ''} maxLength={200} onChange={(value) => set({ model_hint: value.trim() || null } as Partial<Body>)} />
          </Field>
          <Field label="Expected outputs" hint="One per line">
            <TextArea value={agent.expected_outputs.join('\n')} rows={2} onChange={(text) => set({ expected_outputs: listFromText(text, 20) } as Partial<Body>)} />
          </Field>
        </>
      ) : null}
      {team ? (
        <>
          <fieldset className="studio-radio-row">
            <legend className="field-label">Stages</legend>
            <div className="role-chip-list">
              {STAGES.map((stage) => (
                <label key={stage} className="check-field">
                  <input type="checkbox" checked={team.stages.includes(stage)} onChange={(event) => set({ stages: STAGES.filter((item) => (item === stage ? event.target.checked : team.stages.includes(item))) } as Partial<Body>)} />
                  {STAGE_LABEL[stage]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="m-0 text-xs text-text-muted">To add roles or change relationships, use the template in a project, design the team there, then save it as a new version from Team Assignment.</p>
          {team.roles.map((role, index) => {
            const setRole = (patch: Partial<TeamBody['roles'][number]>) => set({ roles: team.roles.map((item, at) => (at === index ? { ...item, ...patch } : item)) } as Partial<Body>);
            return (
              <fieldset key={role.key} className="studio-radio-row rounded-control border border-border p-3">
                <legend className="field-label px-1">{role.name}</legend>
                <Field label={`Role ${index + 1} name`}>
                  <TextInput value={role.name} maxLength={200} onChange={(name) => setRole({ name })} />
                </Field>
                <Field label="Responsibilities">
                  <TextArea value={role.responsibilities_md} rows={3} maxLength={20_000} onChange={(responsibilities_md) => setRole({ responsibilities_md })} />
                </Field>
                <Field label="Instructions">
                  <TextArea value={role.instructions_md} rows={3} maxLength={20_000} onChange={(instructions_md) => setRole({ instructions_md })} />
                </Field>
              </fieldset>
            );
          })}
        </>
      ) : null}
      <fieldset className="studio-radio-row">
        <legend className="field-label">Integrations</legend>
        <div className="role-chip-list">
          {INTEGRATIONS.map((name) => (
            <label key={name} className="check-field">
              <input type="checkbox" checked={body.integrations.includes(name)} onChange={(event) => set({ integrations: INTEGRATIONS.filter((item) => (item === name ? event.target.checked : body.integrations.includes(item))) })} />
              {INTEGRATION_LABEL[name]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-grid">
        <Field label="Ardent version" hint="For example >=2.2.0; empty for any">
          <TextInput value={body.runtime_req.ardent ?? ''} maxLength={40} onChange={(value) => set({ runtime_req: { ...body.runtime_req, ardent: value.trim() || null } })} />
        </Field>
        <Field label="Backend">
          <Select
            value={body.runtime_req.backend}
            options={[{ value: 'any', label: 'Any' }, { value: 'llamacpp', label: 'llama.cpp' }, { value: 'codex', label: 'Codex' }]}
            onChange={(backend) => set({ runtime_req: { ...body.runtime_req, backend: backend as Body['runtime_req']['backend'] } })}
          />
        </Field>
      </div>
      <Field label="Changelog" hint={mode === 'version' ? 'Required: what this version changes' : 'Optional'}>
        <TextInput value={changelog} maxLength={2000} onChange={setChangelog} />
      </Field>
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
    </Drawer>
  );
}
