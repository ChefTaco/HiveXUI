import { useEffect, useState } from 'react';
import { productEnabled } from '../../lib/runtime';
import { can } from '../../lib/permissions';
import type { AdminUser } from '../../lib/types';
import {
  Panel,
  Button,
  Field,
  TextInput,
  TextArea,
  Select,
  Toggle,
  JsonBlock,
  CopyField,
  ConfirmDialog,
} from '../../components/ui';
import { skillsApi as api } from './api';
import type {
  Skill,
  Release,
  Channel,
  Target,
  Audit,
  Receipt,
  DeploymentJob,
} from '../../../contracts/hiveskills.generated';

export default function SkillsModule({
  currentUser,
}: {
  currentUser: AdminUser | null;
}) {
  if (!productEnabled('hiveskills'))
    return (
      <Panel title="HiveSkills">
        <p>The skills registry is not configured for this installation.</p>
      </Panel>
    );
  return <Registry currentUser={currentUser} />;
}
function Registry({ currentUser }: { currentUser: AdminUser | null }) {
  const [skills, setSkills] = useState<Skill[]>([]),
    [channels, setChannels] = useState<Channel[]>([]),
    [targets, setTargets] = useState<Target[]>([]),
    [audit, setAudit] = useState<Audit[]>([]),
    [receipts, setReceipts] = useState<Receipt[]>([]),
    [jobs, setJobs] = useState<DeploymentJob[]>([]);
  const [admin, setAdmin] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(''),
    [releases, setReleases] = useState<Release[]>([]),
    [version, setVersion] = useState(''),
    [channel, setChannel] = useState<'stable' | 'canary'>('canary');
  const [form, setForm] = useState({
      slug: '',
      name: '',
      description: '',
      homepage: '',
      enabled: true,
    }),
    [target, setTarget] = useState({
      name: '',
      host: '',
      username: '',
      enabled: true,
    }),
    [allowlist, setAllowlist] = useState('');
  const [upload, setUpload] = useState({
      version: '',
      notes: '',
      minHermesVersion: '',
      maxHermesVersion: '',
    }),
    [file, setFile] = useState<File | null>(null),
    [oneTime, setOneTime] = useState(''),
    [confirm, setConfirm] = useState<'delete' | 'withdraw' | null>(null);
  const canWrite =
    admin &&
    (can(currentUser, 'hiveskills:write') ||
      can(currentUser, 'hiveskills:admin'));
  async function refresh() {
    setError('');
    const catalog = await api.catalog();
    setSkills(catalog);
    const identity = await api.me();
    setAdmin(identity.isAdmin);
    if (identity.isAdmin) {
      const result = await Promise.allSettled([
        api.skills(),
        api.channels(),
        api.targets(),
        api.receipts(),
        api.deployments(),
        api.audit(),
      ]);
      const [s, c, t, r, j, a] = result;
      if (s?.status === 'fulfilled') setSkills(s.value as Skill[]);
      if (c?.status === 'fulfilled') setChannels(c.value as Channel[]);
      if (t?.status === 'fulfilled') setTargets(t.value as Target[]);
      if (r?.status === 'fulfilled') setReceipts(r.value);
      if (j?.status === 'fulfilled') setJobs(j.value);
      if (a?.status === 'fulfilled') setAudit(a.value as Audit[]);
      const failures = result.filter((entry) => entry.status === 'rejected');
      if (failures.length)
        setError(
          'Some registry administration panels are unavailable for this identity.',
        );
    }
  }
  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : 'Registry unavailable'),
    );
    return () => setOneTime('');
  }, []);
  useEffect(() => {
    let active = true;
    setReleases([]);
    setVersion('');
    if (selected && admin)
      void api
        .releases(selected)
        .then((value) => {
          if (active) setReleases(value);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [selected, admin]);
  async function run(action: () => Promise<unknown>, refreshAfter = true) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (refreshAfter) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registry operation failed');
    } finally {
      setBusy(false);
    }
  }
  function select(skill: Skill) {
    setSelected(skill.slug);
    setForm({ ...skill, homepage: skill.homepage ?? '' });
    setOneTime('');
  }
  async function uploadArchive() {
    if (!file || !selected)
      throw Error('Choose a skill and a release archive.');
    if (file.size > 48 * 1024 * 1024)
      throw Error('The archive must be at most 48 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 32768)
      binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    const expected = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    )
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const release = await api.upload(selected, {
      ...upload,
      archiveBase64: btoa(binary),
    });
    if (release.sha256 !== expected)
      throw Error(
        'Uploaded archive digest does not match. Do not promote this release.',
      );
    setReleases(await api.releases(selected));
    setFile(null);
    setNotice('Immutable release stored; review the digest before promotion.');
  }
  return (
    <div className="skills-module">
      <div className="page-head">
        <div>
          <h2>Skills and assignments</h2>
          <p>
            Versioned archives, release channels and scoped agent distribution.
          </p>
        </div>
        <Button onClick={() => void run(refresh)} loading={busy}>
          Refresh
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <Panel title="Catalogue" eyebrow={`${skills.length} skills`}>
        <div className="check-list">
          {skills.map((skill) => (
            <div className="check-row" key={skill.slug}>
              <div>
                <strong>{skill.name}</strong>
                <span>
                  {skill.description} · {skill.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <Button onClick={() => select(skill)}>Open {skill.slug}</Button>
            </div>
          ))}
          {!skills.length && <p>No skills have been registered.</p>}
        </div>
      </Panel>
      {admin && (
        <>
          <Panel title={selected ? 'Edit ' + selected : 'Register a skill'}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const body = { ...form, homepage: form.homepage || null };
                  if (selected) await api.update(selected, body);
                  else {
                    const created = await api.create(body);
                    select(created);
                  }
                });
              }}
            >
              <div className="form-grid">
                {(['slug', 'name', 'homepage'] as const).map((key) => (
                  <Field
                    key={key}
                    label={
                      key === 'slug'
                        ? 'Skill identifier'
                        : key === 'name'
                          ? 'Name'
                          : 'Project URL'
                    }
                  >
                    <TextInput
                      value={form[key]}
                      disabled={
                        !canWrite || (key === 'slug' && Boolean(selected))
                      }
                      required={key !== 'homepage'}
                      onChange={(event) => setForm({ ...form, [key]: event })}
                    />
                  </Field>
                ))}
              </div>
              <Field label="Description">
                <TextArea
                  value={form.description}
                  required
                  disabled={!canWrite}
                  onChange={(event) => setForm({ ...form, description: event })}
                />
              </Field>
              <Toggle
                disabled={!canWrite}
                label="Enabled"
                checked={form.enabled}
                onChange={(enabled) => setForm({ ...form, enabled })}
              />
              <Button type="submit" disabled={!canWrite} loading={busy}>
                Save skill
              </Button>{' '}
              <Button
                type="button"
                onClick={() => {
                  setSelected('');
                  setForm({
                    slug: '',
                    name: '',
                    description: '',
                    homepage: '',
                    enabled: true,
                  });
                }}
              >
                New skill
              </Button>{' '}
              {selected && (
                <Button
                  type="button"
                  variant="danger"
                  disabled={!canWrite}
                  onClick={() => setConfirm('delete')}
                >
                  Delete skill
                </Button>
              )}
            </form>
          </Panel>
          {selected && (
            <Panel title="Immutable releases">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(uploadArchive);
                }}
              >
                <div className="form-grid">
                  {(
                    ['version', 'minHermesVersion', 'maxHermesVersion'] as const
                  ).map((key) => (
                    <Field
                      label={
                        {
                          version: 'Version',
                          minHermesVersion: 'Minimum Hermes version',
                          maxHermesVersion: 'Maximum Hermes version',
                        }[key]
                      }
                      key={key}
                    >
                      <TextInput
                        value={upload[key]}
                        required={key === 'version'}
                        disabled={!canWrite}
                        onChange={(event) =>
                          setUpload({ ...upload, [key]: event })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <Field label="Release notes">
                  <TextArea
                    value={upload.notes}
                    disabled={!canWrite}
                    onChange={(event) => setUpload({ ...upload, notes: event })}
                  />
                </Field>
                <Field label="Archive (.tar.gz, up to 48 MiB)">
                  <input
                    type="file"
                    accept=".tar.gz,.tgz"
                    disabled={!canWrite}
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={!canWrite || !file}
                  loading={busy}
                >
                  Upload release
                </Button>
              </form>
              {releases.map((release) => (
                <div className="check-row" key={release.version}>
                  <div>
                    <strong>{release.version}</strong>
                    <span>
                      {release.minHermesVersion ?? 'Any minimum'} –{' '}
                      {release.maxHermesVersion ?? 'Any maximum'}
                    </span>
                    <code style={{ overflowWrap: 'anywhere' }}>
                      {release.sha256}
                    </code>
                  </div>
                </div>
              ))}
              <Field label="Release to promote">
                <Select
                  value={version}
                  onChange={setVersion}
                  options={[
                    { value: '', label: 'Choose a version' },
                    ...releases.map((release) => ({
                      value: release.version,
                      label: release.version,
                    })),
                  ]}
                />
              </Field>
              <Field label="Channel">
                <Select
                  value={channel}
                  onChange={(value) => setChannel(value as 'stable' | 'canary')}
                  options={[
                    { value: 'canary', label: 'Canary' },
                    { value: 'stable', label: 'Stable' },
                  ]}
                />
              </Field>
              <Button
                disabled={!canWrite || !version}
                loading={busy}
                onClick={() =>
                  void run(() => api.promote(selected, channel, version))
                }
              >
                Promote reviewed release
              </Button>{' '}
              <Button
                disabled={!canWrite}
                onClick={() => setConfirm('withdraw')}
              >
                Withdraw from {channel}
              </Button>
            </Panel>
          )}
          <Panel title="Channel assignments">
            {channels.length ? (
              <div
                className="table-wrap"
                role="region"
                aria-label="Channel assignments"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>Skill</th>
                      <th>Version</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map((entry) => (
                      <tr key={entry.channel + entry.skill_slug}>
                        <td>{entry.channel}</td>
                        <td>{entry.skill_slug}</td>
                        <td>{entry.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No releases have been assigned to a channel.</p>
            )}
          </Panel>
          <Panel title="Agent targets">
            <div className="check-list">
              {targets.map((entry) => (
                <div className="check-row" key={entry.name}>
                  <div>
                    <strong>{entry.name}</strong>
                    <span>{entry.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <Button
                    onClick={() => {
                      setTarget(entry);
                      setOneTime('');
                    }}
                  >
                    Configure
                  </Button>
                </div>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => api.target(target.name, target));
              }}
            >
              <div className="form-grid">
                {(['name', 'host', 'username'] as const).map((key) => (
                  <Field
                    key={key}
                    label={
                      {
                        name: 'Target name',
                        host: 'Host endpoint',
                        username: 'Host account',
                      }[key]
                    }
                  >
                    <TextInput
                      value={target[key]}
                      required
                      disabled={!canWrite}
                      onChange={(event) =>
                        setTarget({ ...target, [key]: event })
                      }
                    />
                  </Field>
                ))}
              </div>
              <Toggle
                disabled={!canWrite}
                label="Target enabled"
                checked={target.enabled}
                onChange={(enabled) => setTarget({ ...target, enabled })}
              />
              <Button type="submit" disabled={!canWrite} loading={busy}>
                Save target
              </Button>
            </form>
            <Field label="Allowed skill identifiers (comma separated; blank permits the selected channel catalogue)">
              <TextInput
                value={allowlist}
                onChange={(event) => setAllowlist(event)}
              />
            </Field>
            <p>
              Enrollment uses the {channel} channel. Re-enrollment replaces the
              target credential.
            </p>
            <Button
              disabled={!canWrite || !target.name}
              loading={busy}
              onClick={() =>
                void run(async () => {
                  setOneTime('');
                  const result = await api.enroll(target.name, {
                    channel,
                    ...(allowlist.trim()
                      ? {
                          skills: allowlist
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }
                      : {}),
                  });
                  setOneTime(result.token);
                })
              }
            >
              Enroll target and show credential once
            </Button>
            {oneTime && (
              <>
                <CopyField label="One-time target credential" value={oneTime} />
                <Button onClick={() => setOneTime('')}>
                  Dismiss credential
                </Button>
              </>
            )}
          </Panel>
          <Panel title="Distribution receipts">
            {receipts.length ? (
              <div
                className="table-wrap"
                role="region"
                aria-label="Distribution receipts"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Channel</th>
                      <th>Latest agent report</th>
                      <th>Reported skills</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((entry) => {
                      const receipt = parseDetails(entry.receipt_json),
                        skills = parseDetails(
                          JSON.stringify(receipt.skills ?? {}),
                        );
                      return (
                        <tr key={entry.target}>
                          <td>{entry.target}</td>
                          <td>{entry.channel}</td>
                          <td>
                            {typeof receipt.status === 'string'
                              ? receipt.status
                              : 'Awaiting agent report'}
                            <br />
                            <small>Agent-reported; {entry.updated_at}</small>
                          </td>
                          <td>
                            {Object.entries(skills).map(([slug, value]) => (
                              <div key={slug}>
                                {slug}:{' '}
                                {String(
                                  parseDetails(JSON.stringify(value)).version ??
                                    'Unknown version',
                                )}
                              </div>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No agent distribution receipts have been received.</p>
            )}
          </Panel>
          <Panel title="Deployment jobs">
            <p>
              Host execution uses Magnus. Existing job receipts remain visible
              while the authenticated job adapter is being completed.
            </p>
            {jobs.length ? (
              <div
                className="table-wrap"
                role="region"
                aria-label="Deployment jobs"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Status</th>
                      <th>Outcome</th>
                      <th>Requested by</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td>{job.target}</td>
                        <td>{job.status}</td>
                        <td>{job.result ?? 'Awaiting outcome'}</td>
                        <td>{job.actor}</td>
                        <td>{job.updated_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No deployment jobs have been recorded.</p>
            )}
          </Panel>
          <Panel title="Registry audit">
            {audit.length ? (
              <div
                className="table-wrap"
                role="region"
                aria-label="Registry audit"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Subject</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((event) => (
                      <tr key={event.id}>
                        <td>{event.created_at}</td>
                        <td>{event.actor}</td>
                        <td>{event.action}</td>
                        <td>{event.subject}</td>
                        <td>
                          <details>
                            <summary>Event details</summary>
                            <JsonBlock value={parseDetails(event.details)} />
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No registry audit events have been recorded.</p>
            )}
            <Button
              disabled={!audit.length || busy}
              onClick={() =>
                void run(async () => {
                  const last = audit.at(-1);
                  if (last) {
                    const next = await api.audit(last.id);
                    setAudit((previous) => [...previous, ...next]);
                  }
                }, false)
              }
            >
              Older events
            </Button>
          </Panel>
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'delete' ? 'Delete this skill?' : 'Withdraw this release?'
        }
        message={
          confirm === 'delete'
            ? 'This removes the registry entry and its assignments. Retain required archives before continuing.'
            : `Agents following ${channel} will no longer receive this skill.`
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          void run(async () => {
            if (action === 'delete') {
              await api.remove(selected);
              setSelected('');
            } else await api.withdraw(selected, channel);
          });
        }}
      />
    </div>
  );
}

function parseDetails(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
