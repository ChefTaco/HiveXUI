// Create agent from definition: Magnus installs an agent template version's definition as a new Ardent
// profile, through ArdentStudio, once Magnus's preflight passes. An Emberpath-alias definition asks for the
// Emberpath client key (the field New Agent uses); the key is dropped as soon as the requests that carry it
// are sent, so a refused key is entered again.
import { useEffect, useMemo, useState } from 'react';
import { Rocket } from 'lucide-react';
import { Badge, Button, Drawer, Field, LoadingRows, ResourceError, Select, TextInput } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { listInstallations } from '../../magnus/pages/agents/ardent/api';
import { EmberpathKeyField } from '../../magnus/pages/agents/ardent/profiles/emberpath-key-field';
import { nodeChoices } from '../../magnus/pages/agents/ardent/profiles/new-agent-logic';
import { idempotencyKey } from '../api/client';
import { buildDefinition, checkDefinitionDeploy, deployDefinition, getAgentOperation, type StudioAgentOperation } from '../api/endpoints';
import {
  definitionNeeds, deployRefusal, deployRequests, preflightErrors, validateDeploy, type DeployErrors, type DeployForm, type PreflightProblem,
} from './definition-deploy-logic';

const POLL_MS = 2_000;
const PROBLEM_LABEL: Record<string, string> = {
  MISSING_BINDING: 'Missing binding', SKILL_VERSION_UNAVAILABLE: 'Skill unavailable', EXTENSION_NOT_REVIEWED: 'Extension not reviewed',
  RUNTIME_INCOMPATIBLE: 'Runtime incompatible', CAPABILITY_MISSING: 'Capability missing', SECRET_UNBOUND: 'Secret unbound',
};
const STEP_TONE = { succeeded: 'success', failed: 'danger', running: 'info', pending: 'neutral', skipped: 'neutral' } as const;

function Problems({ problems }: { problems: readonly PreflightProblem[] }) {
  if (!problems.length) return null;
  return (
    <div role="alert" className="grid gap-1">
      <p className="m-0 text-sm text-danger">Magnus cannot install this definition on that node yet:</p>
      <ul className="m-0 grid gap-1 text-sm">
        {problems.map((problem, index) => (
          <li key={`${problem.code}-${index}`}>
            <span className="cell-strong">{PROBLEM_LABEL[problem.code] ?? problem.code}</span>: {problem.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Operation({ operation }: { operation: StudioAgentOperation }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STEP_TONE[operation.status]} dot>{operation.status === 'succeeded' ? 'Created' : operation.status === 'failed' ? 'Stopped' : 'Creating'}</Badge>
        <span className="font-mono text-sm text-text-muted">{operation.agent_ref}</span>
      </div>
      <ol className="m-0 grid gap-1 text-sm" aria-label="Steps">
        {operation.steps.map((step) => (
          <li key={step.name} data-step={step.name} className="flex flex-wrap items-center gap-2">
            <Badge tone={STEP_TONE[step.status]}>{step.status}</Badge>
            <span className="font-mono">{step.name}</span>
            {step.error ? <span className="text-danger">{step.error}</span> : null}
          </li>
        ))}
      </ol>
      {operation.status === 'failed' ? (
        <p role="alert" className="m-0 break-words text-sm text-danger">
          {operation.error ?? 'The install stopped.'} Finished steps are kept; resume the operation from the profile in the Magnus console.
        </p>
      ) : null}
      {operation.status === 'succeeded' ? <p role="status" className="m-0 text-sm text-success">The agent is running with the definition&apos;s identity, skills and HiveMem memory.</p> : null}
      {operation.status === 'running' ? <p role="status" className="m-0 text-sm text-text-muted">The install continues on the server if you close this drawer.</p> : null}
    </div>
  );
}

function DeployFormView({ templateId, version, onClose }: { templateId: string; version: number; onClose: () => void }) {
  const built = useMagnusResource(() => buildDefinition(templateId, version), [templateId, version]);
  const installations = useMagnusResource((signal) => listInstallations(signal), []);
  const choices = useMemo(() => nodeChoices(installations.data ?? []).filter((choice) => !choice.disabledReason), [installations.data]);
  const needs = useMemo(() => (built.data ? definitionNeeds(built.data.definition) : null), [built.data]);
  const [form, setForm] = useState<DeployForm>({ nodeId: '', profileId: '', alias: '' });
  // The Emberpath client key lives here, apart from the form, only until the requests that carry it are sent.
  const [emberpathKey, setEmberpathKey] = useState('');
  const [errors, setErrors] = useState<DeployErrors>({});
  const [problems, setProblems] = useState<PreflightProblem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<StudioAgentOperation | null>(null);
  const update = (patch: Partial<DeployForm>) => setForm((current) => ({ ...current, ...patch }));

  const firstNode = choices[0]?.installation.nodeId;
  useEffect(() => {
    if (firstNode && !form.nodeId) update({ nodeId: firstNode });
  }, [firstNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the install until it finishes.
  useEffect(() => {
    if (operation?.status !== 'running') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getAgentOperation(operation.id, controller.signal).then(setOperation, () => setOperation({ ...operation }));
    }, POLL_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [operation]);

  if (!built.data || !needs) {
    return built.loading ? <LoadingRows rows={4} /> : <ResourceError error={built.error} title="This version cannot become an agent definition" onRetry={() => void built.refresh()} />;
  }
  if (operation) {
    return (
      <div className="grid gap-4">
        <Operation operation={operation} />
        <div className="flex justify-end">
          <Button variant={operation.status === 'running' ? 'ghost' : 'primary'} onClick={onClose}>{operation.status === 'running' ? 'Close' : 'Done'}</Button>
        </div>
      </div>
    );
  }

  async function create() {
    const found = validateDeploy(form, needs!, emberpathKey);
    setErrors(found);
    setProblems([]);
    setMessage(null);
    if (Object.keys(found).length) return;
    let requests: ReturnType<typeof deployRequests>;
    try {
      requests = deployRequests(form, needs!, emberpathKey);
    } finally {
      // The key is in the requests now; the field never holds it again.
      setEmberpathKey('');
    }
    setBusy(true);
    try {
      const checked = await checkDefinitionDeploy(templateId, version, requests.check);
      if (!checked.preflight.ok) {
        const { errors: fieldErrors, rest } = preflightErrors(checked.preflight.problems, needs!);
        setErrors(fieldErrors);
        setProblems(rest);
        return;
      }
      setOperation(await deployDefinition(templateId, version, requests.deploy, idempotencyKey()));
    } catch (caught) {
      const refusal = deployRefusal(caught, needs!);
      setErrors(refusal.errors);
      setProblems(refusal.problems);
      setMessage(refusal.message);
    } finally {
      setBusy(false);
    }
  }

  const { definition, omitted } = built.data;
  return (
    <form className="grid gap-4" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <p className="m-0 text-sm">
        Magnus installs <span className="cell-strong">{definition.name}</span> as a new Ardent profile with its persona{definition.skills.length ? `, ${definition.skills.length} pinned ${definition.skills.length === 1 ? 'skill' : 'skills'}` : ''} and HiveMem memory, once its preflight passes. Existing agents are never changed.
      </p>
      {omitted.length ? (
        <div className="grid gap-1">
          <p className="m-0 text-sm text-text-muted">Not carried by the definition:</p>
          <ul className="m-0 text-sm text-text-muted">
            {omitted.map((item) => <li key={`${item.kind}:${item.name}`}>{item.name}: {item.reason}</li>)}
          </ul>
        </div>
      ) : null}
      {installations.data ? (
        choices.length ? (
          <Field label="Node">
            <Select value={form.nodeId} onChange={(nodeId) => update({ nodeId })} options={choices.map((choice) => ({ value: choice.installation.nodeId, label: choice.installation.nodeName }))} />
            {errors.nodeId ? <span role="alert" className="text-xs text-danger">{errors.nodeId}</span> : null}
          </Field>
        ) : (
          <p role="alert" className="m-0 text-sm text-danger">No node can take a new agent: install Ardent and an up-to-date Magnus agent on one first.</p>
        )
      ) : installations.loading ? (
        <p className="m-0 text-sm text-text-muted">Reading Ardent installations…</p>
      ) : (
        <p role="alert" className="m-0 text-sm text-danger">{errorMessage(installations.error, 'Ardent installations are unavailable')}</p>
      )}
      <Field label="Profile ID" hint="The new Ardent profile on that node: letters, digits, hyphens and underscores.">
        <TextInput value={form.profileId} required maxLength={64} autoComplete="off" spellCheck={false} aria-invalid={!!errors.profileId} onChange={(profileId) => update({ profileId: profileId.trim() })} />
        {errors.profileId ? <span role="alert" className="text-xs text-danger">{errors.profileId}</span> : null}
      </Field>
      {needs.modelAlias ? (
        <Field label="Emberpath alias" hint="The definition names no model: bind the Emberpath alias the agent uses.">
          <TextInput value={form.alias} required maxLength={200} autoComplete="off" spellCheck={false} aria-invalid={!!errors.alias} onChange={(alias) => update({ alias: alias.trim() })} />
          {errors.alias ? <span role="alert" className="text-xs text-danger">{errors.alias}</span> : null}
        </Field>
      ) : needs.alias ? (
        <p className="m-0 text-sm">Model: Emberpath alias <span className="font-mono">{needs.alias}</span>{errors.alias ? <span role="alert" className="block text-xs text-danger">{errors.alias}</span> : null}</p>
      ) : null}
      {needs.emberpathKey ? (
        <EmberpathKeyField value={emberpathKey} onChange={(value) => { setEmberpathKey(value); setErrors(({ emberpathKey: _drop, ...rest }) => rest); }} error={errors.emberpathKey} profileId={form.profileId} />
      ) : null}
      <Problems problems={problems} />
      {message ? <p role="alert" className="m-0 break-words text-sm text-danger">{message}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" icon={<Rocket className="size-4" />} loading={busy} disabled={!choices.length}>Create agent</Button>
      </div>
    </form>
  );
}

/** The Create agent from definition drawer for an agent template version. */
export function DefinitionDeployDrawer({ open, templateId, version, templateName, onClose }: {
  open: boolean;
  templateId: string;
  version: number;
  templateName: string;
  onClose: () => void;
}) {
  return (
    <Drawer open={open} title={`Create agent from ${templateName}`} eyebrow={`Agent definition · v${version}`} onClose={onClose}>
      {open ? <DeployFormView templateId={templateId} version={version} onClose={onClose} /> : null}
    </Drawer>
  );
}
