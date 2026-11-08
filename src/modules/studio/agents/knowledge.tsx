import { FileText } from 'lucide-react';
import { Badge, EmptyState, Panel, TableFrame } from '@ui';
import { MemoryPanel } from '../../magnus/pages/agents/ardent/profile/editors';
import { formatBytes, KNOWLEDGE_LABEL, KNOWLEDGE_TONE } from '../projects/logic';
import { shortSha } from './logic';
import type { AgentContext } from './page';
import { Loaded, ScopeBadge } from './shared';

/** The project's reference files as HiveMem knowledge: what every agent on the team can search. */
function ProjectReferences({ context }: { context: AgentContext }) {
  const { snapshot } = context;
  if (!snapshot)
    return (
      <Panel title="Project references">
        <EmptyState compact icon={<FileText className="size-5" />} title="Open this agent from a project" message="A project's reference files are shared knowledge for the agents on its team. Open the agent from a project to see them." />
      </Panel>
    );
  const references = snapshot.files.filter((file) => file.purpose === 'reference');
  return (
    <Panel
      title="Project references"
      description={`Searchable by every agent on this project's team, through the project's HiveMem workspace${snapshot.project.hivemem.state === 'ready' ? '' : ` (workspace ${snapshot.project.hivemem.state})`}.`}
      actions={<ScopeBadge scope="project" />}
      padding={references.length ? 'none' : 'md'}
      className="min-w-0"
    >
      {references.length ? (
        <TableFrame label="Project references">
          <table>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Knowledge</th>
                <th scope="col">Source</th>
                <th scope="col">Revision</th>
                <th scope="col" className="num">Chunks</th>
              </tr>
            </thead>
            <tbody>
              {references.map((file) => {
                                return (
                  <tr key={file.id}>
                    <td>
                      <span className="block break-all">{file.name}</span>
                      <span className="text-xs text-text-muted">
                        {file.mime} · {formatBytes(file.size)}
                      </span>
                    </td>
                    <td>
                      <Badge tone={KNOWLEDGE_TONE[file.knowledge.state]} dot>
                        {KNOWLEDGE_LABEL[file.knowledge.state]}
                      </Badge>
                      {file.knowledge.error ? <span className="block text-xs text-danger">{file.knowledge.error}</span> : null}
                    </td>
                    <td className="break-all font-mono text-xs">{file.knowledge.source_id ?? '—'}</td>
                    <td className="font-mono text-xs">{shortSha(file.knowledge.revision)}</td>
                    <td className="num">{file.knowledge.chunks ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      ) : (
        <EmptyState compact icon={<FileText className="size-5" />} title="No references yet" message="Add reference files from Files in the top bar. Each one is indexed into the project's HiveMem workspace." />
      )}
    </Panel>
  );
}

export function KnowledgeTab({ context }: { context: AgentContext }) {
  const { nodeId, profileId, memory } = context;
  return (
    <div className="page-stack">
      <ProjectReferences context={context} />
      <section className="agent-section" aria-labelledby="agent-private-memory">
        <div className="agent-section__head">
          <h3 id="agent-private-memory" className="m-0 text-base font-semibold text-text-strong">
            Private memory
          </h3>
          <ScopeBadge scope="private" />
        </div>
        <p className="m-0 text-sm text-text-muted">What the agent has stored in its own HiveMem memory. Other agents and projects do not see it.</p>
        <Loaded resource={memory} title="HiveMem status could not be read from the node">
          {(status) => <MemoryPanel nodeId={nodeId} profileId={profileId} status={status} title="Private to this agent" placeholder="Search this agent's private memory" />}
        </Loaded>
      </section>
    </div>
  );
}
