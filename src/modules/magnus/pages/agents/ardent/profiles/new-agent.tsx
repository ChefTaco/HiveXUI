// New Agent: creates an Ardent agent on a fleet node through Magnus (POST /ardent/agents) and follows
// the deploy operation step by step. The fleet profiles page shows it inline; the Studio can host the
// same component in a Drawer and hear the new agent through onDone.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Brain, ExternalLink, Rocket, RotateCcw } from 'lucide-react';
import { Badge, Button, Field, Select, TextArea, TextInput, Toggle } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../../../api/errors';
import { useMagnusResource } from '../../../../api/use-resource';
import { ADMIN_ONLY, RequireRole } from '../../../../session';
import { identityFileName } from '../profile/editors';
import { deployAgent, listInstallations, readResource, resumeAgentOperation } from '../api';
import { skillsSchema, type ArdentInstallation } from '../schemas';
import { NodeCommandOwners } from '../command-owners';
import { agentOperationError, OperationChecklist, useAgentOperation } from './agent-operation';
import {
  agentRef,
  ARTIFACT_SIZES,
  buildRequest,
  emptyDraft,
  formatMiB,
  nodeChoices,
  skillList,
  starterIdentity,
  stoppedAt,
  suggestPort,
  validateStep,
  WIZARD_STEPS,
  type NewAgentDraft,
  type NodeChoice,
  type StepErrors,
  type WizardStep,
} from './new-agent-logic';
import './new-agent.css';

export interface NewAgentWizardProps {
  /** The fleet's Ardent installations, when the host already has them. Otherwise the wizard reads them. */
  installations?: readonly ArdentInstallation[] | undefined;
  /** The new agent's reference (`node~profile`), once the operator opens it after a successful deploy. */
  onDone: (agentRef: string) => void;
  /** Offers Cancel before the deploy starts. */
  onCancel?: (() => void) | undefined;
  /** The deploy was accepted and is running, for a host that shows the agent as being created. */
  onDeployStarted?: ((agentRef: string) => void) | undefined;
  /** The label of the button that calls onDone after a successful deploy. */
  doneLabel?: string | undefined;
  className?: string | undefined;
}

/** ADMIN only, like every Ardent action. Other roles see why instead. */
export function NewAgentWizard(props: NewAgentWizardProps) {
  return (
    <RequireRole roles={ADMIN_ONLY} fallback={<p className={cn('m-0 text-sm text-text-muted', props.className)}>Creating Ardent agents needs the Magnus ADMIN role.</p>}>
      <Wizard {...props} />
    </RequireRole>
  );
}

const FieldError = ({ message }: { message: string | undefined }) => (message ? <span role="alert" className="text-xs text-danger">{message}</span> : null);

function StepRail({ step }: { step: WizardStep }) {
  return (
    <ol className="agent-wizard-rail" aria-label="New Agent steps">
      {WIZARD_STEPS.map((label, index) => (
        <li key={label} className={cn('agent-wizard-rail__step', index === step && 'agent-wizard-rail__step--current', index < step && 'agent-wizard-rail__step--done')} aria-current={index === step ? 'step' : undefined}>
          <span className="agent-wizard-rail__index num" aria-hidden="true">{index + 1}</span>
          <span className="agent-wizard-rail__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function NodeStep({ draft, update, choices, errors }: StepProps & { choices: readonly NodeChoice[] }) {
  return (
    <div className="grid gap-4">
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-2">Node</legend>
        {choices.length === 0 ? <p className="m-0 text-sm text-text-muted">No managed node reports an Ardent installation.</p> : null}
        {choices.map(({ installation, disabledReason }) => (
          <label key={installation.nodeId} className={cn('agent-wizard-choice', draft.nodeId === installation.nodeId && 'agent-wizard-choice--selected', disabledReason && 'agent-wizard-choice--disabled')}>
            <input type="radio" name="new-agent-node" value={installation.nodeId} checked={draft.nodeId === installation.nodeId} disabled={!!disabledReason}
              onChange={() => update({ nodeId: installation.nodeId, apiPort: String(suggestPort(installation) ?? '') })} />
            <span className="min-w-0">
              <span className="block font-medium">{installation.nodeName}</span>
              <span className="flex flex-wrap gap-x-2 font-mono text-xs text-text-muted">
                <span className="break-all">{installation.hostname}</span>
                <span aria-hidden="true">·</span>
                <span>Ardent {installation.version ?? 'version unknown'}</span>
                <span aria-hidden="true">·</span>
                <span>{installation.profiles.length} {installation.profiles.length === 1 ? 'profile' : 'profiles'}</span>
              </span>
              {disabledReason ? <span className="mt-1 block text-xs text-warning">{disabledReason}</span> : null}
            </span>
          </label>
        ))}
        <FieldError message={errors.nodeId} />
      </fieldset>
      <div className="form-grid form-grid--compact">
        <Field label="Profile ID" hint="Letters, digits, hyphens and underscores. It names the agent's service and its HiveMem identity.">
          <TextInput value={draft.profileId} maxLength={64} spellCheck={false} autoComplete="off" aria-invalid={!!errors.profileId}
            onChange={(profileId) => update({ profileId, ...(draft.identity === starterIdentity(draft.profileId) ? { identity: starterIdentity(profileId) } : {}) })} />
          <FieldError message={errors.profileId} />
        </Field>
        <Field label="API port" hint="The next free port on the node is suggested.">
          <TextInput type="number" inputMode="numeric" min={1024} max={65535} value={draft.apiPort} aria-invalid={!!errors.apiPort} onChange={(apiPort) => update({ apiPort })} />
          <FieldError message={errors.apiPort} />
        </Field>
      </div>
    </div>
  );
}

function IdentityStep({ draft, update, errors }: StepProps) {
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-text-muted">The agent reads both files on every turn. Start from these and make them its own; you can edit them later on the profile&apos;s Identity tab.</p>
      <div className="agent-wizard-identity">
        {(['soul', 'identity'] as const).map((kind) => (
          <Field key={kind} label={identityFileName(kind)} hint={kind === 'soul' ? 'Character and values: how it thinks and behaves.' : 'Role: what it works on and how.'}>
            <TextArea aria-label={identityFileName(kind)} spellCheck value={draft[kind]} onChange={(value) => update(kind === 'soul' ? { soul: value } : { identity: value })} className="agent-wizard-editor font-mono text-xs" />
            <FieldError message={errors[kind]} />
          </Field>
        ))}
      </div>
    </div>
  );
}

function ModelStep({ draft, update, errors, installation }: StepProps & { installation: ArdentInstallation | undefined }) {
  // The skills a running profile on the node reports: every profile on a node shares its skill directory.
  const sibling = installation?.profiles.find((profile) => profile.running);
  const known = useMagnusResource((signal) => readResource(installation!.nodeId, sibling!.id, 'skills', skillsSchema, signal), [installation?.nodeId, sibling?.id], { enabled: !!installation && !!sibling });
  const skills = known.data?.skills ?? [];
  const toggle = (name: string, on: boolean) => update({ skills: on ? [...draft.skills, name] : draft.skills.filter((item) => item !== name) });
  return (
    <div className="grid gap-5">
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1">Model</legend>
        <div className="agent-wizard-pair">
          {([['emberpath', 'Emberpath alias', 'A model alias served by the Emberpath gateway Magnus is configured with.'], ['llamacpp', 'llama.cpp server', 'Any OpenAI-compatible server, by URL and model name.']] as const).map(([kind, label, hint]) => (
            <label key={kind} className={cn('agent-wizard-choice', draft.modelKind === kind && 'agent-wizard-choice--selected')}>
              <input type="radio" name="new-agent-model" value={kind} checked={draft.modelKind === kind} onChange={() => update({ modelKind: kind })} />
              <span><span className="block font-medium">{label}</span><span className="block text-xs text-text-muted">{hint}</span></span>
            </label>
          ))}
        </div>
        {draft.modelKind === 'emberpath' ? (
          <Field label="Emberpath alias">
            <TextInput value={draft.alias} maxLength={200} spellCheck={false} placeholder="general" aria-invalid={!!errors.alias} onChange={(alias) => update({ alias })} />
            <FieldError message={errors.alias} />
          </Field>
        ) : (
          <div className="form-grid">
            <Field label="Base URL">
              <TextInput value={draft.baseUrl} type="url" maxLength={2048} spellCheck={false} placeholder="http://192.0.2.20:8080/v1" aria-invalid={!!errors.baseUrl} onChange={(baseUrl) => update({ baseUrl })} />
              <FieldError message={errors.baseUrl} />
            </Field>
            <Field label="Model">
              <TextInput value={draft.model} maxLength={200} spellCheck={false} placeholder="model name" aria-invalid={!!errors.model} onChange={(model) => update({ model })} />
              <FieldError message={errors.model} />
            </Field>
          </div>
        )}
      </fieldset>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1">Skills</legend>
        {skills.length ? (
          <div className="agent-wizard-skills">
            {skills.map((skill) => (
              <label key={skill.name} className="check-field">
                <input type="checkbox" checked={draft.skills.includes(skill.name)} onChange={(event) => toggle(skill.name, event.target.checked)} />
                <span className="min-w-0"><span className="block font-medium">{skill.name}</span>{skill.description ? <span className="block text-xs text-text-muted">{skill.description}</span> : null}</span>
              </label>
            ))}
          </div>
        ) : <p className="m-0 text-xs text-text-muted">{known.loading ? 'Reading the skills on this node…' : 'No running profile on this node lists its skills. Name them below.'}</p>}
        <Field label="More skills" hint="Comma-separated skill names. The profile template's default skills stay enabled.">
          <TextInput value={draft.extraSkills} spellCheck={false} placeholder="skill-name, another-skill" aria-invalid={!!errors.skills} onChange={(extraSkills) => update({ extraSkills })} />
          <FieldError message={errors.skills} />
        </Field>
      </fieldset>
      <div className="agent-wizard-pair">
        <div className="agent-wizard-note">
          <Toggle checked disabled onChange={() => undefined} label="HiveMem memory (required)" />
          <p className="m-0 mt-2 text-xs text-text-muted">
            Every new agent gets its own HiveMem identity. Magnus enrolls it, gives the node a credential only this profile reads, and points the
            profile&apos;s memory at it, private by default. Studio projects share knowledge through it, so it cannot be turned off.
          </p>
        </div>
        <Field label="Largest artifact" hint={`Applied on Ardent 2.2.0 or later${installation?.version ? `; this node runs ${installation.version}` : ''}.`}>
          <Select value={String(draft.artifactsMaxBytes)} onChange={(value) => update({ artifactsMaxBytes: Number(value) })}
            options={ARTIFACT_SIZES.map((size) => ({ value: String(size), label: `${formatMiB(size)}${size === 2 * 1024 * 1024 ? ' (Ardent default)' : ''}` }))} />
        </Field>
      </div>
    </div>
  );
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="agent-wizard-fact"><dt className="text-xs text-text-muted">{label}</dt><dd className="m-0 break-words text-sm">{children}</dd></div>
);

function ReviewStep({ draft, installation }: { draft: NewAgentDraft; installation: ArdentInstallation | undefined }) {
  const skills = skillList(draft);
  return (
    <div className="grid gap-4">
      <dl className="agent-wizard-facts m-0">
        <Fact label="Node">{installation ? `${installation.nodeName} (${installation.hostname})` : draft.nodeId}</Fact>
        <Fact label="Profile"><span className="font-mono">{draft.profileId}</span> on port <span className="num">{draft.apiPort}</span></Fact>
        <Fact label="Model">{draft.modelKind === 'emberpath' ? <>Emberpath alias <span className="font-mono">{draft.alias}</span></> : <><span className="break-all font-mono">{draft.baseUrl}</span> · <span className="font-mono">{draft.model}</span></>}</Fact>
        <Fact label="Skills">{skills.length ? skills.join(', ') : 'Template defaults only'}</Fact>
        <Fact label="HiveMem"><Badge tone="success" dot>Enrolled on deploy</Badge></Fact>
        <Fact label="Largest artifact">{formatMiB(draft.artifactsMaxBytes)}</Fact>
      </dl>
      <div className="agent-wizard-identity">
        {(['soul', 'identity'] as const).map((kind) => (
          <details key={kind} className="agent-wizard-preview" open>
            <summary className="text-sm font-medium">{identityFileName(kind)}</summary>
            <pre className="code-block m-0 mt-2 whitespace-pre-wrap">{draft[kind]}</pre>
          </details>
        ))}
      </div>
    </div>
  );
}

interface StepProps {
  draft: NewAgentDraft;
  update: (patch: Partial<NewAgentDraft>) => void;
  errors: StepErrors;
}

function Wizard({ installations: given, onDone, onCancel, onDeployStarted, doneLabel = 'Open profile', className }: NewAgentWizardProps) {
  const loaded = useMagnusResource((signal) => listInstallations(signal), [], { enabled: !given });
  const installations = given ?? loaded.data;
  const choices = useMemo(() => nodeChoices(installations ?? []), [installations]);
  const [step, setStep] = useState<WizardStep>(0);
  const [draft, setDraft] = useState<NewAgentDraft>(emptyDraft);
  const [errors, setErrors] = useState<StepErrors>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [operationId, setOperationId] = useState<string | null>(null);
  const { operation, note, follow } = useAgentOperation();
  const installation = installations?.find((item) => item.nodeId === draft.nodeId);
  const update = (patch: Partial<NewAgentDraft>) => setDraft((current) => ({ ...current, ...patch }));

  // Start on the first node that can take an agent, with its next free port.
  const first = choices.find((choice) => !choice.disabledReason)?.installation;
  useEffect(() => {
    if (first && !draft.nodeId) update({ nodeId: first.nodeId, apiPort: String(suggestPort(first) ?? '') });
  }, [first?.nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function next() {
    const found = validateStep(step, draft, choices);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((step + 1) as WizardStep);
  }
  async function deploy() {
    setBusy(true);
    setProblem('');
    try {
      const id = await deployAgent(buildRequest(draft));
      setOperationId(id);
      setStep(4);
      follow(id);
      onDeployStarted?.(agentRef(draft.nodeId, draft.profileId));
    } catch (caught) {
      setProblem(agentOperationError(caught, installation?.nodeName, 'The agent could not be deployed'));
    } finally {
      setBusy(false);
    }
  }
  async function resume() {
    if (!operationId) return;
    setBusy(true);
    setProblem('');
    try {
      follow(await resumeAgentOperation(operationId));
    } catch (caught) {
      setProblem(agentOperationError(caught, installation?.nodeName, 'The deploy could not be resumed'));
    } finally {
      setBusy(false);
    }
  }

  if (!installations) {
    return <p className={cn('m-0 text-sm', loaded.error ? 'text-danger' : 'text-text-muted', className)} role={loaded.error ? 'alert' : undefined}>{loaded.error ? errorMessage(loaded.error, 'Ardent installations are unavailable') : 'Reading Ardent installations…'}</p>;
  }
  const status = operation?.status ?? 'running';
  return (
    <div className={cn('agent-wizard', className)}>
      <StepRail step={step} />
      <div className="agent-wizard-body">
        {step === 0 ? <NodeStep draft={draft} update={update} errors={errors} choices={choices} /> : null}
        {step === 1 ? <IdentityStep draft={draft} update={update} errors={errors} /> : null}
        {step === 2 ? <ModelStep draft={draft} update={update} errors={errors} installation={installation} /> : null}
        {step === 3 ? <ReviewStep draft={draft} installation={installation} /> : null}
        {step === 4 ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status === 'succeeded' ? 'success' : status === 'failed' ? 'danger' : 'info'} dot>{status === 'succeeded' ? 'Deployed' : status === 'failed' ? 'Stopped' : 'Deploying'}</Badge>
              <span className="text-sm text-text-muted"><span className="font-mono">{draft.profileId}</span> on {installation?.nodeName ?? draft.nodeId}</span>
            </div>
            <OperationChecklist operation={operation} kind="deploy" />
            {note ? <p role="status" className="m-0 text-sm text-warning">{note}</p> : null}
            {status === 'failed' ? <p role="alert" className="m-0 break-words text-sm text-danger">{stoppedAt(operation)} Finished steps are kept; Resume continues from the step that failed.</p> : null}
            {status === 'failed' && operation ? <NodeCommandOwners key={operation.attempts} nodeId={operation.nodeId} /> : null}
            {status === 'succeeded' ? <p role="status" className="m-0 text-sm text-success">The agent is running with its identity, model and HiveMem memory.</p> : null}
          </div>
        ) : null}
        {problem ? <p role="alert" className="m-0 mt-3 break-words text-sm text-danger">{problem}</p> : null}
      </div>
      <div className="agent-wizard-actions">
        {step < 4 && onCancel ? <Button variant="ghost" onClick={onCancel}>Cancel</Button> : null}
        {step > 0 && step < 4 ? <Button icon={<ArrowLeft className="size-4" />} disabled={busy} onClick={() => { setErrors({}); setProblem(''); setStep((step - 1) as WizardStep); }}>Back</Button> : null}
        {step < 3 ? <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={next}>Next</Button> : null}
        {step === 3 ? <Button variant="primary" icon={<Rocket className="size-4" />} loading={busy} onClick={() => void deploy()}>Deploy</Button> : null}
        {step === 4 && status === 'failed' ? <Button variant="primary" icon={<RotateCcw className="size-4" />} loading={busy} onClick={() => void resume()}>Resume</Button> : null}
        {step === 4 && status === 'succeeded' ? <Button variant="primary" icon={<ExternalLink className="size-4" />} onClick={() => onDone(agentRef(draft.nodeId, draft.profileId))}>{doneLabel}</Button> : null}
        {step === 4 && status === 'running' ? <span className="inline-flex items-center gap-2 text-sm text-text-muted"><Brain className="size-4" aria-hidden="true" /> The deploy continues on the server if you leave this page.</span> : null}
      </div>
    </div>
  );
}
