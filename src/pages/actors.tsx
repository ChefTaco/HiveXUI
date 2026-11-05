import { apiFetch } from '../lib/transport';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Drawer, EmptyState, Field, JsonBlock, Panel, Select, StatCard, TextArea, TextInput, type Tone } from '../components/ui';
import { useToast } from '../components/toast';
import { Icon } from '../components/icons';
import { useStore } from '../lib/store';
import { adminApi, ApiError } from '../lib/api';
import { can } from '../lib/permissions';
import type { AdminUser, HiveActor, HiveActorLifecycleResponse } from '../lib/types';
import { formatTime, relativeTime } from '../lib/format';
import { browserIdentity, enrollmentInstallationId, selectEnrollmentInstallation } from '../lib/runtime';
type CoordinatedActor = HiveActor & { enrollmentStatus?: string; credentialExpiresAt?: string | null; legacyReceiptAvailable?: boolean; latestOperation?: { id: string; action: string; status: string } | null };

const KIND_LABELS: Record<HiveActor['kind'], string> = {
  user: 'User',
  'service-account': 'Service Account',
  'system-user': 'System User',
  'router-key': 'Router Key',
  'memory-agent': 'Memory Agent',
};

function actorTone(actor: HiveActor): Tone {
  if (actor.status === 'inactive') return 'neutral';
  if (actor.kind === 'user') return 'accent';
  if (actor.kind === 'memory-agent' || actor.kind === 'router-key') return 'info';
  return 'neutral';
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ActorsPage({ currentUser }: { currentUser: AdminUser | null }) {
  const { data: legacyData, refresh: legacyRefresh, refreshing: legacyRefreshing } = useStore();
  const suite = !!browserIdentity();
  const [installationId, setInstallationId] = useState<string | undefined>(() => {
    const requested = new URLSearchParams(location.search).get('installation');
    return requested && /^[a-z0-9][a-z0-9-]{0,63}$/.test(requested) ? requested : enrollmentInstallationId();
  });
  const [installations, setInstallations] = useState<string[] | null>(null);
  const [enrollments, setEnrollments] = useState<CoordinatedActor[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshGeneration = useRef(0);
  const canRead = can(currentUser, suite ? 'iam:sa:read' : 'hive:actors:read');
  useEffect(() => {
    if (!suite || !canRead) return;
    let active = true;
    void adminApi.hiveActorInstallations().then(result => {
      if (!active) return;
      setInstallations(result.installations);
      if (!installationId && result.installations.length === 1) setInstallationId(result.installations[0]);
    }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Installation namespaces are unavailable'); });
    return () => { active = false; };
  }, [suite, canRead, currentUser?.id]);
  useEffect(() => { if (installationId) selectEnrollmentInstallation(installationId); }, [installationId]);
  const refresh = useCallback(async () => {
    if (!suite) { await legacyRefresh(); return; }
    if (!canRead || !installationId) { setEnrollments([]); return; }
    const generation = ++refreshGeneration.current;
    setLoading(true); setLoadError(null);
    try { const result = await adminApi.hiveActors(); if (generation === refreshGeneration.current) setEnrollments(result.data); }
    catch (error) { if (generation === refreshGeneration.current) setLoadError(error instanceof Error ? error.message : 'Identity enrollment APIs are unavailable'); }
    finally { if (generation === refreshGeneration.current) setLoading(false); }
  }, [suite, canRead, currentUser?.id, installationId, legacyRefresh]);
  useEffect(() => { if (suite) void refresh(); }, [suite, refresh]);
  const data = { actors: suite ? enrollments : legacyData.actors };
  const refreshing = suite ? loading : legacyRefreshing;
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get('actor'));
  const selected = data.actors.find((actor) => actor.id === selectedId) ?? null;
  useEffect(() => {
    const restore = () => setSelectedId(new URLSearchParams(location.search).get('actor'));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  function setSelected(actor: HiveActor | null) {
    setSelectedId(actor?.id ?? null);
    const url = new URL(location.href);
    if (actor) url.searchParams.set('actor', actor.id); else url.searchParams.delete('actor');
    history.replaceState(null, '', url);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<HiveActorLifecycleResponse | null>(null);
  const [createForm, setCreateForm] = useState({
    agentId: '',
    displayName: '',
    description: '',
    iamClientId: 'hive-router',
    roleIds: '',
    scopes: 'memories:read, memories:write, sessions:read, sessions:write, context:read, agents:read, workspaces:read, queue:read',
    hostLabel: location.hostname,
    workspaceId: 'default',
    owningProject: '',
    expiresHours: '24',
    allowedIps: '',
  });
  const counts = useMemo(() => {
    return data.actors.reduce<Record<string, number>>((acc, actor) => {
      acc[actor.kind] = (acc[actor.kind] ?? 0) + 1;
      return acc;
    }, {});
  }, [data.actors]);
  const canWriteActors = can(currentUser, suite ? 'iam:sa:write' : 'hive:actors:write');
  useEffect(() => { setActionResult(null); }, [currentUser?.id, installationId]);
  function operationStorage(actorId: string, action: string): string { return `hive.actor.operation:${suite ? installationId + ':' : ''}${actorId}:${action}`; }
  async function recoverOrResume(actor: CoordinatedActor, resume: boolean) {
    if (!actor.latestOperation) return;
    setBusy('resume-' + actor.id);
    try {
      setActionResult(await (resume ? adminApi.resumeHiveActor(actor.id, actor.latestOperation.id) : adminApi.recoverHiveActorOperation(actor.id, actor.latestOperation.id)));
      await refresh();
    } catch (error) { toast.error(resume ? 'Resume refused' : 'Recovery refused', error instanceof Error ? error.message : 'Inspect the owning product before retrying'); }
    finally { setBusy(null); }
  }
  async function recoverLegacy(actor: CoordinatedActor) {
    setBusy('recover-' + actor.id);
    try { setActionResult({ ok: true, ...await adminApi.recoverLegacyActorReceipt(actor.id), identifiers: actor.identifiers }); }
    catch (error) { toast.error('Legacy receipt unavailable', error instanceof Error ? error.message : 'Inspect retained recovery evidence'); }
    finally { setBusy(null); }
  }

  async function runLifecycle(action: 'disable' | 'rotate', actor: HiveActor) {
    if (action === 'disable' && !window.confirm(`Disable ${actor.label} across linked Hive services?`)) return;
    setBusy(`${action}-${actor.id}`);
    try {
      const storageKey = operationStorage(actor.id, action);
      const operationId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, operationId);
      const body = { kind: actor.kind, label: actor.label, identifiers: actor.identifiers, operationId };
      const response = action === 'disable'
        ? await adminApi.disableHiveActor(actor.id, body)
        : await adminApi.rotateHiveActor(actor.id, body);
      setActionResult(response);
      if (action === 'disable' && response.ok) {
        sessionStorage.removeItem(storageKey);
        sessionStorage.removeItem(operationStorage(actor.id, 'rotate'));
      }
      if (response.ok) toast.success(action === 'disable' ? 'Actor disabled' : 'Actor rotated', actor.label);
      else toast.error('Actor operation partially completed', typeof response.remediation === 'string' ? response.remediation : 'Inspect the step results before retrying.');
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 410) sessionStorage.removeItem(operationStorage(actor.id, action));
      toast.error(action === 'disable' ? 'Disable failed' : 'Rotate failed', caught instanceof Error ? caught.message : 'Actor lifecycle request failed');
    } finally {
      setBusy(null);
    }
  }

  async function acknowledgeLatest() {
    if (!actionResult || typeof actionResult.actorId !== 'string') return;
    const operationId = typeof actionResult.operationId === 'string' ? actionResult.operationId : null;
    const suffix = operationId ? `/operations/${encodeURIComponent(operationId)}/receipt` : '/receipt';
    const response = await apiFetch(`${suite ? '/api/iam/enrollments' : '/api/hive/actors'}/${encodeURIComponent(actionResult.actorId)}${suffix}${suite && installationId ? '?installationId=' + encodeURIComponent(installationId) : ''}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Receipt acknowledgement failed');
    if (typeof actionResult.action === 'string') sessionStorage.removeItem(operationStorage(actionResult.actorId, actionResult.action));
    setActionResult(null);
  }

  async function containLatest() {
    if (!actionResult || typeof actionResult.actorId !== 'string') return;
    if (!window.confirm('Disable all linked resources for this partial actor? Records and content are retained.')) return;
    const operationId = actionResult.action === 'disable' && typeof actionResult.operationId === 'string' ? actionResult.operationId : crypto.randomUUID();
    const storageKey = operationStorage(actionResult.actorId, 'disable');
    sessionStorage.setItem(storageKey, operationId);
    const response = await adminApi.disableHiveActor(actionResult.actorId, { identifiers: actionResult.identifiers ?? {}, operationId });
    setActionResult(response);
    if (response.ok) { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(operationStorage(actionResult.actorId, 'rotate')); toast.success('Partial actor contained'); }
    else toast.error('Containment partially completed', 'Retry Disable to finish the remaining steps.');
    await refresh();
  }

  async function createActor() {
    setBusy('create');
    try {
      const description = createForm.description.trim();
      const hostLabel = createForm.hostLabel.trim();
      const payload = {
        agentId: createForm.agentId.trim(),
        displayName: createForm.displayName.trim(),
        iamClientId: createForm.iamClientId.trim(),
        roleIds: splitList(createForm.roleIds),
        scopes: splitList(createForm.scopes),
        allowedIps: splitList(createForm.allowedIps),
        workspaceId: createForm.workspaceId,
        owningProject: createForm.owningProject,
        expiresHours: Number(createForm.expiresHours),
        ...(description ? { description } : {}),
        ...(hostLabel ? { hostLabel } : {}),
      };
      const response = await adminApi.createHiveActor({
        ...payload,
      });
      setActionResult(response);
      if (response.ok) toast.success('Actor created', createForm.displayName || createForm.agentId);
      else toast.error('Actor partially created', typeof response.remediation === 'string' ? response.remediation : 'Inspect the step results before retrying.');
      if (response.ok) setCreateForm((current) => ({ ...current, agentId: '', displayName: '', description: '', hostLabel: '', allowedIps: '' }));
      await refresh();
    } catch (caught) {
      toast.error('Create failed', caught instanceof Error ? caught.message : 'Could not create actor');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{suite ? 'Identity enrollment' : 'Hive Actors'}</h2>
          <p>{suite ? 'Oathweave coordinates explicitly linked technical identities. Each product owns its credentials and permissions.' : 'Users, service accounts, host identities, Router keys, and Memory agents in one inventory.'}</p>
        </div>
        <Button variant="ghost" icon={<Icon.Refresh className="btn-ico" />} loading={refreshing} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>
      {suite && !canRead && <Panel title="Access unavailable"><p>Your Oathweave account needs identity inventory permission.</p></Panel>}
      {loadError && <Panel title="Identity enrollment unavailable"><p role="alert">{loadError}</p><p>Configure the owning product APIs or inspect installation health before retrying.</p></Panel>}
      {suite && installations && installations.length > 0 && <Panel title="Installation"><Field label="Independent installation" hint="Select the exact namespace. Product accounts, operation IDs and recovery receipts stay separate."><Select disabled={!!busy} value={installationId ?? ''} options={[{ value: '', label: 'Select an installation' }, ...installations.map(id => ({ value: id, label: id }))]} onChange={value => {
        if (!value) return;
        refreshGeneration.current++;
        selectEnrollmentInstallation(value); setInstallationId(value); setEnrollments([]); setSelected(null); setActionResult(null);
        const url = new URL(location.href); url.searchParams.set('installation', value); history.replaceState(null, '', url);
      }} /></Field></Panel>}
      {suite && installations?.length === 0 && <Panel title="Enrollment unconfigured"><p>No product enrollment APIs are configured for your authorized installations.</p></Panel>}

      <div className="page-grid--4">
        <StatCard label="Actors" value={data.actors.length} sub="linked identities" tone="accent" />
        <StatCard label="IAM" value={(counts.user ?? 0) + (counts['service-account'] ?? 0)} sub="users and services" tone="accent" />
        <StatCard label="Router" value={counts['router-key'] ?? 0} sub="client keys" tone="accent" />
        <StatCard label="Memory" value={counts['memory-agent'] ?? 0} sub="registered agents" tone="accent" />
      </div>

      <Panel title="Create Technical Actor" eyebrow="IAM + Router + Memory">
        <div className="form-grid">
          <Field label="Agent ID"><TextInput value={createForm.agentId} onChange={(agentId) => setCreateForm((current) => ({ ...current, agentId }))} placeholder="memory-host-agent" /></Field>
          <Field label="Workspace"><TextInput value={createForm.workspaceId} onChange={(workspaceId) => setCreateForm((current) => ({ ...current, workspaceId }))} /></Field>
          <Field label="Owning project"><TextInput value={createForm.owningProject} onChange={(owningProject) => setCreateForm((current) => ({ ...current, owningProject }))} /></Field>
          <Field label="Credential lifetime (hours)"><TextInput value={createForm.expiresHours} onChange={(expiresHours) => setCreateForm((current) => ({ ...current, expiresHours }))} /></Field>
          <Field label="Display name"><TextInput value={createForm.displayName} onChange={(displayName) => setCreateForm((current) => ({ ...current, displayName }))} placeholder="memory-host Hermes" /></Field>
          <Field label="IAM client ID"><TextInput value={createForm.iamClientId} onChange={(iamClientId) => setCreateForm((current) => ({ ...current, iamClientId }))} /></Field>
          <Field label="Host label"><TextInput value={createForm.hostLabel} onChange={(hostLabel) => setCreateForm((current) => ({ ...current, hostLabel }))} placeholder="memory-host" /></Field>
          <Field label="Role IDs" hint="Comma or newline separated"><TextArea rows={3} value={createForm.roleIds} onChange={(roleIds) => setCreateForm((current) => ({ ...current, roleIds }))} /></Field>
          <Field label="Memory permissions" hint="Explicit non-admin permissions; model credentials use Emberpath's native inference policy"><TextArea rows={3} value={createForm.scopes} onChange={(scopes) => setCreateForm((current) => ({ ...current, scopes }))} /></Field>
          <Field label="Allowed IPs" hint="Comma or newline separated IPv4 addresses"><TextArea rows={3} value={createForm.allowedIps} onChange={(allowedIps) => setCreateForm((current) => ({ ...current, allowedIps }))} /></Field>
          <Field label="Description"><TextArea rows={3} value={createForm.description} onChange={(description) => setCreateForm((current) => ({ ...current, description }))} /></Field>
        </div>
        <div className="panel-actions">
          <Button variant="primary" icon={<Icon.Plus className="btn-ico" />} loading={busy === 'create'} disabled={!canWriteActors || suite && !installationId || !createForm.agentId.trim() || !createForm.displayName.trim() || !createForm.iamClientId.trim()} onClick={() => void createActor()}>
            Create actor
          </Button>
        </div>
        {actionResult?.secrets ? (
          <div className="json-stack">
            <p className="panel-eyebrow">Latest one-time secrets and steps</p>
            <JsonBlock value={actionResult} />
            <Button variant="ghost" disabled={!actionResult.ok} onClick={() => { void acknowledgeLatest().catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Acknowledgement failed')); }}>I have saved these credentials</Button>
            {!actionResult.ok && <Button variant="danger" disabled={!canWriteActors} onClick={() => { void containLatest().catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Containment failed')); }}>Contain partial actor</Button>}
          </div>
        ) : null}
      </Panel>

      <Panel title="Actor Graph" eyebrow={`${data.actors.length} records`}>
        {data.actors.length === 0 ? (
          <EmptyState icon={<Icon.Key width={34} height={34} />} message={suite ? 'No technical identities have been explicitly enrolled or migrated into this installation.' : 'No actors could be assembled from IAM, Router, or Memory.'} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Kind</th>
                  <th>Sources</th>
                  <th>Capabilities</th>
                  <th>Last Activity</th>
                  <th>Links</th>
                </tr>
              </thead>
              <tbody>
                {data.actors.map((actor) => (
                  <tr key={actor.id} className="row-clickable" onClick={() => setSelected(actor)}>
                    <td className="cell-strong"><Button variant="ghost" onClick={() => setSelected(actor)}>{actor.label}</Button></td>
                    <td><Badge tone={actorTone(actor)} dot>{KIND_LABELS[actor.kind]}</Badge></td>
                    <td className="cell-mono">{actor.sources.join(', ')}</td>
                    <td>{actor.capabilities.slice(0, 3).join(', ') || 'standard'}</td>
                    <td className="cell-mono" title={actor.lastActivityAt ? formatTime(actor.lastActivityAt) : undefined}>
                      {actor.lastActivityAt ? relativeTime(actor.lastActivityAt) : 'unknown'}
                    </td>
                    <td className="cell-mono">{actor.linkedResourceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        eyebrow={selected ? KIND_LABELS[selected.kind] : ''}
        title={selected?.label ?? ''}
        footer={selected ? (
          <div className="inline-actions justify-end">
            <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            {suite && (selected as CoordinatedActor).latestOperation && <Button variant="ghost" disabled={!canWriteActors} onClick={() => void recoverOrResume(selected, false)}>Recover receipt</Button>}
            {suite && (selected as CoordinatedActor).legacyReceiptAvailable && <Button variant="ghost" disabled={!canWriteActors} onClick={() => void recoverLegacy(selected)}>Legacy enrollment receipt</Button>}
            {suite && ['pending','partial'].includes((selected as CoordinatedActor).latestOperation?.status ?? '') && <Button variant="ghost" loading={busy === 'resume-' + selected.id} disabled={!canWriteActors} onClick={() => void recoverOrResume(selected, true)}>Resume operation</Button>}
            <Button variant="ghost" loading={busy === `rotate-${selected.id}`} disabled={!canWriteActors || suite && !selected.capabilities.includes('credential:rotate')} onClick={() => void runLifecycle('rotate', selected)}>Rotate</Button>
            <Button variant="danger" loading={busy === `disable-${selected.id}`} disabled={!canWriteActors || suite && !selected.capabilities.includes('credential:disable')} onClick={() => void runLifecycle('disable', selected)}>Disable</Button>
          </div>
        ) : <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected ? (
          <>
            <div className="kv-list">
              <div className="kv-row"><span>Status</span><span>{selected.status}</span></div>
              {suite && <div className="kv-row"><span>Enrollment</span><span>{(selected as CoordinatedActor).enrollmentStatus}</span></div>}
              {suite && (selected as CoordinatedActor).credentialExpiresAt && <div className="kv-row"><span>Credential deadline</span><span>{formatTime((selected as CoordinatedActor).credentialExpiresAt!)}</span></div>}
              <div className="kv-row"><span>Sources</span><span>{selected.sources.join(', ')}</span></div>
              <div className="kv-row"><span>Links</span><span className="cell-mono">{selected.linkedResourceCount}</span></div>
              <div className="kv-row"><span>Last Activity</span><span className="cell-mono">{selected.lastActivityAt ? formatTime(selected.lastActivityAt) : 'unknown'}</span></div>
            </div>
            {suite && ((selected as CoordinatedActor).enrollmentStatus === 'migration-review' || (selected as CoordinatedActor).latestOperation?.status === 'migration-review') && <p role="status">This legacy operation has an unknown outcome. Capture any unexpired receipt, inspect the recorded product resources, and explicitly contain incomplete enrollment before issuing new credentials.</p>}
            <p className="panel-eyebrow mt-5">Identifiers</p>
            <JsonBlock value={selected.identifiers} />
            <p className="panel-eyebrow mt-5">Capabilities</p>
            <JsonBlock value={selected.capabilities} />
            {actionResult ? (
              <>
                <p className="panel-eyebrow mt-5">Latest Lifecycle Result</p>
                <JsonBlock value={actionResult} />
              </>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </>
  );
}
