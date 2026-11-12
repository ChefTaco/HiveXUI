import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Badge, Panel, statusTone, buttonClass } from '@ui';
import { adminApi } from '@lib/api';
import { productInstalled } from '../../../lib/runtime';
import { idempotencyKey } from '../api/client';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { readInstallation, readResource } from '../../magnus/pages/agents/ardent/api';
import { channelLabel, displayValue, profileHref, taskIsFinal } from '../../magnus/pages/agents/ardent/logic';
import { SettingsForm, SkillList } from '../../magnus/pages/agents/ardent/profile/editors';
import { SkillCatalog } from '../../magnus/pages/agents/ardent/profile/skill-catalog';
import { skillListKey, skillStates } from '../../magnus/pages/agents/ardent/profile/skill-catalog-logic';
import { channelsSchema, peersSchema, revisionedTextSchema, skillsSchema, taskListSchema } from '../../magnus/pages/agents/ardent/schemas';
import { StudioLink } from '../link';
import { projectHref } from '../routes';
import { installCatalogSkill } from './api';
import { projectTasks } from './logic';
import type { AgentContext } from './page';
import { Loaded, ScopeBadge, when } from './shared';

const fleetHref = (context: AgentContext) => '/fleet' + profileHref(context.nodeId, context.profileId);

function SkillsPanel({ context }: { context: AgentContext }) {
  const { nodeId, profileId, agentRef } = context;
  const skills = useMagnusResource(async (signal) => {
    const [list, config] = await Promise.all([readResource(nodeId, profileId, 'skills', skillsSchema, signal), readResource(nodeId, profileId, 'config', revisionedTextSchema, signal)]);
    // The list is the running profile; the switches and the catalog follow the saved configuration.
    return { skills: skillStates(list.skills, config.text), revision: config.revision };
  }, [agentRef]);
  const installation = useMagnusResource((signal) => readInstallation(nodeId, signal), [nodeId]);
  // The newest configuration revision a skill switch answered, the base for enabling an installed skill.
  const [revision, setRevision] = useState<string | null>(null);
  return (
    <Panel title="Skills" description="Local working methods on the agent's node, and the HiveSkills catalog. A change takes effect when the profile restarts." actions={<ScopeBadge scope="global" />} className="min-w-0">
      <Loaded resource={skills} title="Skills could not be read from the node">
        {(data) => (
          <>
            <SkillList key={skillListKey(data.skills, data.revision)} nodeId={nodeId} profileId={profileId} initial={data.skills} initialRevision={data.revision}
              description="Enable or disable each skill" onChange={(_skills, next) => setRevision(next)} />
            <SkillCatalog
              className="agent-note mt-4 rounded-control border border-border bg-surface-sunken p-3"
              installed={data.skills}
              revision={revision ?? data.revision}
              studioLevel={installation.data ? installation.data.capabilities?.studio ?? 0 : null}
              nodeName={installation.data?.nodeName}
              install={(request) => installCatalogSkill(agentRef, request, idempotencyKey())}
              onInstalled={() => { setRevision(null); void skills.refresh(); }}
            />
          </>
        )}
      </Loaded>
    </Panel>
  );
}

/** Emberpath model aliases this console can see, for an agent whose endpoint is the Emberpath gateway. */
function EmberpathAliases() {
  const enabled = productInstalled('emberpath');
  const aliases = useMagnusResource(async () => (await adminApi.aliases()).data, [], { enabled });
  if (!enabled || !aliases.data?.length) return null;
  return (
    <div className="mt-4 grid gap-2">
      <p className="m-0 text-sm font-semibold text-text-strong">Emberpath aliases</p>
      <p className="m-0 text-xs text-text-muted">When the llama.cpp endpoint is the Emberpath gateway, use one of these as the model.</p>
      <ul className="agent-chips" aria-label="Emberpath aliases">
        {aliases.data.map((alias) => (
          <li key={alias.id}>
            <Badge tone={alias.enabled ? 'info' : 'neutral'}>
              <span className="font-mono">{alias.alias}</span>
              {alias.enabled ? null : ' · disabled'}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModelPanel({ context }: { context: AgentContext }) {
  const { nodeId, profileId, agentRef, agent } = context;
  const config = useMagnusResource((signal) => readResource(nodeId, profileId, 'config', revisionedTextSchema, signal), [agentRef]);
  return (
    <section className="agent-section min-w-0" aria-labelledby="agent-model">
      <div className="agent-section__head">
        <h3 id="agent-model" className="m-0 text-base font-semibold text-text-strong">
          Model
        </h3>
        <ScopeBadge scope="global" />
      </div>
      <Loaded resource={config} title="The configuration could not be read from the node">
        {(entry) => <SettingsForm key={entry.revision} nodeId={nodeId} profileId={profileId} entry={entry} section="providers" running={agent?.running ?? false} rawEditorHint="in Fleet details" />}
      </Loaded>
      <EmberpathAliases />
    </section>
  );
}

function ConnectionsPanel({ context }: { context: AgentContext }) {
  const { nodeId, profileId, agentRef } = context;
  const reads = useMagnusResource(async (signal) => {
    const [channels, peers] = await Promise.all([readResource(nodeId, profileId, 'channels', channelsSchema, signal), readResource(nodeId, profileId, 'peers', peersSchema, signal)]);
    return { channels, peers: peers.peers };
  }, [agentRef]);
  return (
    <Panel
      title="Channels and peers"
      description="Where the agent takes requests besides Studio, and the agents it may call."
      actions={
        <StudioLink href={fleetHref(context)} className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })}>
          Configure
          <ArrowUpRight className="btn-ico" aria-hidden="true" />
        </StudioLink>
      }
      className="min-w-0"
    >
      <Loaded resource={reads} title="Channels and peers could not be read from the node">
        {({ channels, peers }) => (
          <dl className="agent-facts m-0 text-sm">
            <dt className="text-text-muted">Channels</dt>
            <dd className="m-0">
              {Object.keys(channels).length ? (
                <ul className="agent-chips" aria-label="Channels">
                  {Object.entries(channels).map(([name, entry]) => (
                    <li key={name}>
                      <Badge tone={entry.enabled ? 'success' : 'neutral'} dot>
                        {channelLabel(name)} {entry.enabled ? 'on' : 'off'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                'None configured'
              )}
            </dd>
            <dt className="text-text-muted">Peers</dt>
            <dd className="m-0">
              {peers.length ? (
                <ul className="agent-chips" aria-label="Peers">
                  {peers.map((peer, index) => (
                    <li key={`${displayValue(peer.id)}${index}`}>
                      <Badge tone={peer.enabled ? 'success' : 'neutral'} dot>
                        {displayValue(peer.id)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                'No authorized peers'
              )}
            </dd>
          </dl>
        )}
      </Loaded>
    </Panel>
  );
}

function TasksPanel({ context }: { context: AgentContext }) {
  const { nodeId, profileId, agentRef, snapshot, projectId } = context;
  const tasks = useMagnusResource((signal) => readResource(nodeId, profileId, 'tasks', taskListSchema, signal), [agentRef], { pollMs: 15_000 });
  const studioTasks = snapshot ? projectTasks(snapshot, agentRef) : [];
  return (
    <Panel title="Active tasks" description="Work the agent has in flight now, on its node and in this project." className="min-w-0">
      {snapshot && projectId ? (
        <div className="mb-4 grid gap-2">
          <p className="m-0 text-sm font-semibold text-text-strong">In this project</p>
          {studioTasks.length ? (
            <ul className="agent-list" aria-label="Project tasks">
              {studioTasks.map((task) => (
                <li key={task.id} className="agent-list__row border-t border-border pt-2 text-sm">
                  <span className="min-w-0 truncate">{task.title}</span>
                  <Badge tone={statusTone(task.state)}>{task.state.replaceAll('_', ' ')}</Badge>
                  {task.conversation_id ? (
                    <StudioLink href={projectHref(projectId, `/room?c=${encodeURIComponent(task.conversation_id)}&task=${encodeURIComponent(task.id)}`)} className="text-xs">
                      Open in Room
                    </StudioLink>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-text-muted">No open project tasks.</p>
          )}
        </div>
      ) : null}
      <p className="m-0 mb-2 text-sm font-semibold text-text-strong">On the node</p>
      <Loaded resource={tasks} title="Tasks could not be read from the node">
        {({ tasks: list }) => {
          const open = list.filter((task) => !taskIsFinal(task.state));
          return open.length ? (
            <ul className="agent-list" aria-label="Node tasks">
              {open.map((task) => (
                <li key={task.id} className="agent-list__row border-t border-border pt-2 text-sm">
                  <span className="min-w-0 truncate">{task.prompt}</span>
                  <Badge tone={statusTone(task.state)}>{task.state}</Badge>
                  <span className="text-xs text-text-muted">{when(task.created_ms)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-text-muted">Nothing running or queued.</p>
          );
        }}
      </Loaded>
    </Panel>
  );
}

export function CapabilitiesTab({ context }: { context: AgentContext }) {
  return (
    <div className="page-stack">
      <SkillsPanel context={context} />
      <ModelPanel context={context} />
      <div className="agent-columns">
        <ConnectionsPanel context={context} />
        <TasksPanel context={context} />
      </div>
    </div>
  );
}
