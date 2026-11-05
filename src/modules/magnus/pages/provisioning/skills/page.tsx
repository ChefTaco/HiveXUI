import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye, FileCode, Package, RefreshCw, Search, Server, Tag, XCircle } from 'lucide-react';
import { Badge, Button, Drawer, EmptyState, PageHeader, TextInput } from '@ui';
import { magnus } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, GLOW_TEXT, PageItem, ScanPanel } from '../../../effects';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { useMagnusSession, WRITE_ROLES } from '../../../session';
import { ResourceError } from '../../../ui/resource-state';
import { initiallyExpanded, matchesSkill, normalizeScan } from './logic';
import { skillScanResponseSchema } from './schemas';

export default function InstalledSkillsPage() {
  const { can } = useMagnusSession();
  const canScan = can(WRITE_ROLES);
  const scan = useMagnusResource((signal) => magnus.post('/scan/skills', skillScanResponseSchema, { signal }), [], { enabled: canScan });
  const nodes = useMemo(() => (scan.data ? normalizeScan(scan.data.data) : null), [scan.data]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<{ name: string; content: string } | null>(null);
  useEffect(() => {
    if (nodes) setExpanded(initiallyExpanded(nodes));
  }, [nodes]);
  const scanning = scan.loading || scan.refreshing;
  const scanned = nodes?.filter((node) => node.status === 'done').length ?? 0;
  const errored = nodes?.filter((node) => node.status === 'error').length ?? 0;
  const totalSkills = nodes?.reduce((sum, node) => sum + (node.status === 'done' ? node.skills.length : 0), 0) ?? 0;
  const toggle = (nodeId: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    return next;
  });
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Provisioning"
          title="Installed skills"
          description="What each online node reports as installed. HiveSkills is the registry."
          status={nodes && !scanning ? <span className="num text-xs text-text-muted">{nodes.length} node{nodes.length === 1 ? '' : 's'} · {totalSkills} skill{totalSkills === 1 ? '' : 's'}{errored ? ` · ${errored} error${errored === 1 ? '' : 's'}` : ''}</span> : undefined}
          actions={canScan ? <Button size="sm" icon={<RefreshCw className="size-4" />} loading={scanning} onClick={() => void scan.refresh()}>{scanning ? 'Scanning…' : 'Rescan'}</Button> : undefined}
        />
      </PageItem>
      {!canScan ? (
        <PageItem><FxPanel interactive={false}><EmptyState icon={<Server className="size-6" />} title="Scanning needs an operator" message="Reading skills from nodes takes the ADMIN or OPERATOR role." /></FxPanel></PageItem>
      ) : null}
      {canScan && scanning ? (
        <PageItem><ScanPanel title="Scanning nodes for skills" description="Probing all online nodes…" scanning nodes={[]} /></PageItem>
      ) : null}
      {canScan && !scanning && nodes && totalSkills > 0 ? (
        <PageItem>
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <TextInput aria-label="Search skills" value={search} onChange={setSearch} placeholder="Search skills by name, description, or tag…" className="w-full pl-9" />
          </div>
        </PageItem>
      ) : null}
      {canScan && !scanning && scan.error ? (
        <PageItem>
          <FxPanel interactive={false} tone="danger" fxTone="danger">
            <ResourceError error={scan.error} title="The scan failed" onRetry={() => void scan.refresh()} />
          </FxPanel>
        </PageItem>
      ) : null}
      {canScan && !scanning && !scan.error && nodes ? (
        nodes.length === 0 ? (
          <PageItem><FxPanel interactive={false}><EmptyState icon={<Server className="size-6" />} title="No online nodes to scan" message="Ensure at least one node agent is running and connected." /></FxPanel></PageItem>
        ) : (
          <>
            {nodes.map((node) => {
              const open = expanded.has(node.nodeId);
              const shown = node.skills.filter((skill) => matchesSkill(skill, search));
              return (
                <PageItem key={node.nodeId}>
                  <FxPanel padding="none" fxTone={node.status === 'error' ? 'danger' : 'accent'} className="overflow-hidden">
                    <button type="button" aria-expanded={open} onClick={() => toggle(node.nodeId)} className="flex w-full cursor-pointer items-center gap-4 p-4 text-left hover:bg-surface-hover">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-accent bg-accent-soft"><Server className="size-4 text-accent" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{node.nodeName}</span>
                          {node.status === 'done' ? <Badge tone={node.skills.length > 0 ? 'success' : 'neutral'}>{node.skills.length} skill{node.skills.length === 1 ? '' : 's'}</Badge> : <Badge tone="danger" dot>Error</Badge>}
                        </span>
                        {node.status === 'error' && node.error ? <span className="mt-0.5 block truncate text-sm text-danger">{node.error}</span> : null}
                        {node.status === 'done' && node.skills.length === 0 ? <span className="mt-0.5 block text-sm text-text-muted">No skills installed on this node</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {node.status === 'done' ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
                        {open ? <ChevronDown className="size-4 text-text-muted" /> : <ChevronRight className="size-4 text-text-muted" />}
                      </span>
                    </button>
                    {open && node.status === 'done' ? (
                      <div className="border-t border-border bg-surface-sunken">
                        {shown.length === 0 ? (
                          <p className="m-0 p-8 text-center text-sm text-text-muted">
                            {node.skills.length === 0 ? <>No skills installed on this node.{hasRoute('/library') ? <> Deploy skills from the <Link href="/library">Library</Link>.</> : null}</> : 'No skills match your search on this node.'}
                          </p>
                        ) : (
                          <div className="divide-y divide-border">
                            {shown.map((skill) => (
                              <div key={skill.name} className="scan-sweep grid gap-3 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Package className="size-4 text-accent" />
                                  <span className="text-sm font-semibold">{skill.name}</span>
                                  {skill.version ? <Badge tone="info">{skill.version}</Badge> : null}
                                </div>
                                {skill.description ? <p className="m-0 text-sm text-text-muted">{skill.description}</p> : null}
                                {skill.tags.length > 0 ? <div className="flex flex-wrap gap-1">{skill.tags.map((tag) => <Badge key={tag}><Tag className="mr-1 inline size-3" />{tag}</Badge>)}</div> : null}
                                <div className="grid gap-3 sm:grid-cols-3">
                                  {[['Author', skill.author || '—'], ['Entry point', skill.entryPoint || '—'], ['Dependencies', skill.dependencies.length ? skill.dependencies.join(', ') : '—']].map(([label, value]) => (
                                    <div key={label} className="rounded-control border border-border bg-surface p-2">
                                      <p className="m-0 mb-0.5 text-xs font-medium text-text-muted">{label}</p>
                                      <p className="m-0 break-words text-sm">{value}</p>
                                    </div>
                                  ))}
                                </div>
                                {skill.files.length > 0 ? (
                                  <div>
                                    <p className="m-0 mb-1.5 text-xs font-medium text-text-muted">Files (<span className="num">{skill.files.length}</span>)</p>
                                    <div className="grid gap-1">
                                      {skill.files.map((file) => (
                                        <button key={file.name} type="button" onClick={() => setViewing(file)} className="glow-hover flex w-full cursor-pointer items-center gap-2 rounded-control border border-border px-3 py-1.5 text-left text-sm hover:border-accent">
                                          <FileCode className="size-3 shrink-0 text-accent" />
                                          <span className="min-w-0 truncate">{file.name}</span>
                                          <Eye className="ml-auto size-3 shrink-0 text-text-muted" />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </FxPanel>
                </PageItem>
              );
            })}
            <PageItem>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                <span className="num">{scanned} node{scanned === 1 ? '' : 's'} scanned · {totalSkills} skill{totalSkills === 1 ? '' : 's'} discovered</span>
                {errored > 0 ? <span className={`flex items-center gap-1 text-danger ${GLOW_TEXT.danger}`}><AlertTriangle className="size-3" />{errored} node{errored === 1 ? '' : 's'} unreachable</span> : null}
              </div>
            </PageItem>
          </>
        )
      ) : null}
      <Drawer open={!!viewing} title={viewing?.name ?? 'File'} eyebrow="Skill file" onClose={() => setViewing(null)}>
        <pre className="code-block m-0 whitespace-pre-wrap">{viewing?.content || '(The node reported this file by name only.)'}</pre>
      </Drawer>
    </div>
  );
}
