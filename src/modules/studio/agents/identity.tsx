import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Badge, Button, Field, Panel, Select, TextInput, buttonClass } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { readResource } from '../../magnus/pages/agents/ardent/api';
import { IdentityFile, Outcome } from '../../magnus/pages/agents/ardent/profile/editors';
import { revisionedTextSchema } from '../../magnus/pages/agents/ardent/schemas';
import { idempotencyKey } from '../api/client';
import { StudioLink } from '../link';
import { PORTRAIT_ACCENTS, PORTRAIT_EMBLEMS, PORTRAIT_PRESETS, type Portrait } from '../room/scene/model';
import { PortraitBadge } from '../room/scene';
import { projectHref } from '../routes';
import { getPresentation, putPresentation, type Presentation } from './api';
import { portraitFor, projectRoles } from './logic';
import type { AgentContext } from './page';
import { Loaded, ScopeBadge } from './shared';

const options = (values: readonly string[]) => values.map((value) => ({ value, label: value.replace(/^persona-/, 'Accent ').replace(/^./, (char) => char.toUpperCase()) }));

/** Studio's own name and portrait for the agent. Neither Ardent nor Magnus reads them. */
function PresentationPanel({ context, saved, onSaved }: { context: AgentContext; saved: Presentation; onSaved: (next: Presentation) => void }) {
  const [name, setName] = useState(saved.display_name ?? '');
  const [portrait, setPortrait] = useState<Portrait>(() => portraitFor(saved.portrait, context.agentRef));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const savedPortrait = portraitFor(saved.portrait, context.agentRef);
  const changed = name.trim() !== (saved.display_name ?? '') || !saved.portrait || (['preset', 'accent', 'emblem'] as const).some((key) => portrait[key] !== savedPortrait[key]);

  async function save() {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const next = await putPresentation(context.agentRef, { display_name: name.trim() || null, portrait, avatar_file_id: saved.avatar_file_id }, idempotencyKey());
      onSaved(next);
      setFeedback('Saved. Every project shows the new name and portrait.');
    } catch (caught) {
      setError(errorMessage(caught, 'The name and portrait could not be saved'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Name and portrait" description="How Studio shows this agent in rooms, teams and reviews." actions={<ScopeBadge scope="global" />} className="min-w-0">
      <div className="agent-presentation">
        <span className="agent-presentation__preview rounded-control border border-border bg-surface-sunken">
          <PortraitBadge portrait={portrait} size={96} />
        </span>
        <div className="field-grid agent-presentation__fields">
          <Field label="Display name" hint={`Empty shows the profile ID, ${context.profileId}.`}>
            <TextInput value={name} maxLength={80} onChange={setName} placeholder={context.profileId} />
          </Field>
          <Field label="Figure">
            <Select value={portrait.preset} onChange={(preset) => setPortrait({ ...portrait, preset: preset as Portrait['preset'] })} options={options(PORTRAIT_PRESETS)} />
          </Field>
          <Field label="Accent">
            <Select value={portrait.accent} onChange={(accent) => setPortrait({ ...portrait, accent: accent as Portrait['accent'] })} options={options(PORTRAIT_ACCENTS)} />
          </Field>
          <Field label="Emblem">
            <Select value={portrait.emblem} onChange={(emblem) => setPortrait({ ...portrait, emblem: emblem as Portrait['emblem'] })} options={options(PORTRAIT_EMBLEMS)} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" loading={busy} disabled={!changed} onClick={() => void save()}>
          Save name and portrait
        </Button>
        <span className="text-xs text-text-muted">Standing responsibilities and communication preferences live in IDENTITY.md below.</span>
      </div>
      <Outcome feedback={feedback} error={error} />
    </Panel>
  );
}

/** The role this agent plays in the open project, as the team revision states it. */
function ProjectRolePanel({ context }: { context: AgentContext }) {
  const { snapshot, projectId, agentRef } = context;
  if (!snapshot || !projectId) return null;
  const roles = projectRoles(snapshot, agentRef);
  const published = Boolean(snapshot.team.current);
  return (
    <Panel
      title="Project role"
      description={published ? `From team revision ${snapshot.team.current!.revision}.` : 'From the unpublished team draft.'}
      actions={<ScopeBadge scope="project" />}
      className="min-w-0"
    >
      {roles.length ? (
        <div className="grid gap-4">
          {roles.map((role) => (
            <article key={role.key} className="agent-role grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="m-0 text-base font-semibold text-text-strong">{role.name}</h4>
                {role.coordinator ? <Badge tone="accent">Coordinator</Badge> : null}
                {role.stage ? <Badge>{role.stage}</Badge> : null}
              </div>
              <dl className="agent-facts m-0 text-sm">
                <dt className="text-text-muted">Responsibilities</dt>
                <dd className="m-0 whitespace-pre-wrap">{role.responsibilities_md || '—'}</dd>
                <dt className="text-text-muted">Instructions</dt>
                <dd className="m-0 whitespace-pre-wrap">{role.instructions_md || 'None beyond the identity files.'}</dd>
                <dt className="text-text-muted">Delivers</dt>
                <dd className="m-0">{role.deliverables.length ? role.deliverables.join(', ') : '—'}</dd>
                <dt className="text-text-muted">Role skills</dt>
                <dd className="m-0">{role.skills.length ? role.skills.map((skill) => skill.ref).join(', ') : '—'}</dd>
              </dl>
              <StudioLink href={projectHref(projectId, `/team?role=${encodeURIComponent(role.key)}`)} className={buttonClass({ variant: 'ghost', size: 'sm', className: 'justify-self-start no-underline' })}>
                Edit in Team Assignment
                <ArrowUpRight className="btn-ico" aria-hidden="true" />
              </StudioLink>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="m-0 text-sm text-text-muted">This agent holds no role in this project&apos;s team.</p>
          <StudioLink href={projectHref(projectId, '/team')} className={buttonClass({ size: 'sm', className: 'justify-self-start no-underline' })}>
            Open Team Assignment
          </StudioLink>
        </div>
      )}
    </Panel>
  );
}

export function IdentityTab({ context }: { context: AgentContext }) {
  const { nodeId, profileId, agentRef } = context;
  const presentation = useMagnusResource((signal) => getPresentation(agentRef, signal), [agentRef]);
  const files = useMagnusResource(async (signal) => {
    const [soul, identity] = await Promise.all([readResource(nodeId, profileId, 'identity/soul', revisionedTextSchema, signal), readResource(nodeId, profileId, 'identity/identity', revisionedTextSchema, signal)]);
    return { soul, identity };
  }, [agentRef]);

  return (
    <div className="page-stack">
      <div className="agent-columns">
        <Loaded resource={presentation} title="The name and portrait could not be loaded">
          {(saved) => (
            <PresentationPanel
              key={saved.updated_at ?? 'new'}
              context={context}
              saved={saved}
              onSaved={(next) => {
                presentation.setData(next);
                context.refreshAgent();
              }}
            />
          )}
        </Loaded>
        <ProjectRolePanel context={context} />
      </div>
      <section className="agent-section" aria-labelledby="agent-identity-files">
        <div className="agent-section__head">
          <h3 id="agent-identity-files" className="m-0 text-base font-semibold text-text-strong">
            Identity files
          </h3>
          <ScopeBadge scope="global" />
        </div>
        <p className="m-0 text-sm text-text-muted">The agent&apos;s persona in every project and channel. Saving keeps the previous version in its history. To try a change first, use Preview.</p>
        <Loaded resource={files} title="The identity files could not be read from the node" rows={6}>
          {({ soul, identity }) => (
            <div className="agent-columns">
              <IdentityFile nodeId={nodeId} profileId={profileId} kind="soul" entry={soul} savedMessage="Saved. The agent uses it from its next turn." />
              <IdentityFile nodeId={nodeId} profileId={profileId} kind="identity" entry={identity} savedMessage="Saved. The agent uses it from its next turn." />
            </div>
          )}
        </Loaded>
      </section>
    </div>
  );
}
