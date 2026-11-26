// Per-project membership (the ArdentStudio release after 0.6.1): open to everyone linked, or only to
// listed Oathweave subjects and roles, each with a project role. Shown to the project's owners;
// Studio administrators are owners of every project.
import { useCallback, useEffect, useId, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { Badge, Button, Drawer, EmptyState, Field, IconButton, LoadingRows, Select, TextInput } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey, StudioApiError } from '../api/client';
import { getProjectMembers, listPeople, putProjectMembers, type LinkedPerson, type ProjectMembers, type ProjectMembersWrite } from '../api/endpoints';

type Role = 'viewer' | 'editor' | 'owner';
type Member = ProjectMembersWrite['members'] extends (infer M)[] | undefined ? M : never;
/** A member as edited here, with the name to show beside it. */
type Row = { member: Member & { role: Role }; label: string };
const ROLES = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Owner' },
];
const keyOf = (member: Member): string => (member.kind === 'subject' ? `subject:${member.issuer ?? ''}:${member.subject}` : `role:${member.name}`);

/** What Studio refused a members change for, in words. */
export function membersRefusal(error: unknown): string {
  if (error instanceof StudioApiError) {
    if (error.code === 'VERSION_CONFLICT') return 'Someone else changed the members meanwhile. The current list is shown; make your change again.';
    if (error.code === 'MEMBERS_NOT_ALLOWED') return 'Members can only be listed when access is limited to listed members.';
    if (error.code === 'OWNER_REQUIRED') return 'Keep at least one owner when access is limited to listed members.';
    if (error.code === 'SELF_LOCKOUT') return 'This change would leave you without owner access. Keep yourself as an owner, or ask a Studio administrator.';
  }
  return errorMessage(error, 'The members could not be saved');
}

function rowsOf(members: ProjectMembers['members']): Row[] {
  return members.map((member) =>
    member.kind === 'subject'
      ? { member: { kind: 'subject', subject: member.subject, issuer: member.issuer, role: member.role }, label: member.display_name ?? member.subject }
      : { member: { kind: 'oathweave_role', name: member.name, role: member.role }, label: `Oathweave role ${member.name}` },
  );
}

export function MembersDrawer({ projectId, projectName, open, onClose, onSaved }: { projectId: string; projectName: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [current, setCurrent] = useState<ProjectMembers | null>(null);
  const [mode, setMode] = useState<'everyone' | 'members'>('everyone');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<{ people: LinkedPerson[]; truncated: boolean } | null>(null);
  const [peopleError, setPeopleError] = useState('');
  const [roleName, setRoleName] = useState('');
  const modeName = useId();

  const load = useCallback(async () => {
    try {
      const members = await getProjectMembers(projectId);
      setCurrent(members);
      setMode(members.mode);
      setRows(rowsOf(members.members));
    } catch (reason) {
      setError(errorMessage(reason, 'The members could not be loaded'));
    }
  }, [projectId]);
  useEffect(() => {
    if (!open) return;
    setError('');
    setNotice('');
    void load();
  }, [open, load]);

  // People are searched once typing pauses.
  useEffect(() => {
    if (!open || mode !== 'members') return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      listPeople(query.trim(), controller.signal)
        .then((result) => {
          setPeople(result);
          setPeopleError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setPeopleError(errorMessage(reason, 'People could not be listed'));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, mode, query]);

  const add = (row: Row) => setRows((list) => (list.some((item) => keyOf(item.member) === keyOf(row.member)) ? list : [...list, row]));
  const listed = new Set(rows.map((row) => keyOf(row.member)));

  async function save() {
    if (!current) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await putProjectMembers(projectId, { base_revision: current.revision, mode, members: mode === 'everyone' ? [] : rows.map((row) => row.member) }, idempotencyKey());
      setCurrent(saved);
      setMode(saved.mode);
      setRows(rowsOf(saved.members));
      setNotice(saved.mode === 'everyone' ? 'Everyone linked to Studio can open this project.' : `Only the ${saved.members.length} listed ${saved.members.length === 1 ? 'member' : 'members'} can open this project.`);
      onSaved();
    } catch (reason) {
      setError(membersRefusal(reason));
      // A stale revision: show what is there now, so the change can be made again on top of it.
      if (reason instanceof StudioApiError && reason.code === 'VERSION_CONFLICT') await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Members"
      eyebrow={projectName}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" loading={busy} disabled={!current} onClick={() => void save()}>
            Save members
          </Button>
        </>
      }
    >
      {error ? <p role="alert" className="m-0 text-sm text-danger">{error}</p> : null}
      {notice ? <p role="status" className="m-0 text-sm">{notice}</p> : null}
      {!current ? (
        error ? null : <LoadingRows rows={3} />
      ) : (
        <>
          <fieldset className="grid gap-2">
            <legend className="stat-label">Who can open this project</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name={modeName} checked={mode === 'everyone'} onChange={() => setMode('everyone')} />
              Everyone linked to Studio (its creator is its owner, everyone else an editor)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name={modeName} checked={mode === 'members'} onChange={() => setMode('members')} />
              Only the members listed here
            </label>
          </fieldset>
          {mode === 'members' ? (
            <>
              {rows.length ? (
                <ul className="studio-file-list" aria-label="Members">
                  {rows.map((row, index) => (
                    <li key={keyOf(row.member)} className="studio-file border-b border-border">
                      <div className="studio-file__main">
                        <span className="studio-file__name cell-strong">{row.label}</span>
                        {row.member.kind === 'subject' ? <span className="text-xs text-text-muted">{row.member.subject}</span> : <Badge>Oathweave role</Badge>}
                      </div>
                      <span className="studio-file__state">
                        <Select
                          aria-label={`Role of ${row.label}`}
                          value={row.member.role}
                          options={ROLES}
                          onChange={(role) => setRows((list) => list.map((item, at) => (at === index ? { ...item, member: { ...item.member, role: role as Role } } : item)))}
                        />
                        <IconButton label={`Remove ${row.label}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setRows((list) => list.filter((_, at) => at !== index))} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact title="No members yet" message="Add at least one owner before saving." />
              )}
              <Field label="Find a person" hint="By name, user or Oathweave subject">
                <TextInput type="search" value={query} onChange={setQuery} />
              </Field>
              {peopleError ? <p role="alert" className="m-0 text-sm text-danger">{peopleError}</p> : null}
              {people ? (
                <ul className="studio-file-list" aria-label="People">
                  {people.people.map((person) => {
                    const member: Member & { role: Role } = { kind: 'subject', subject: person.subject, issuer: person.issuer, role: 'editor' };
                    const name = person.display_name ?? person.user_id;
                    return (
                      <li key={`${person.issuer} ${person.subject}`} className="studio-file border-b border-border">
                        <div className="studio-file__main">
                          <span className="studio-file__name">{name}</span>
                          <span className="text-xs text-text-muted">{person.subject}</span>
                        </div>
                        <Button size="sm" icon={<UserPlus className="size-4" />} disabled={listed.has(keyOf(member))} onClick={() => add({ member, label: name })}>
                          Add<span className="sr-only"> {name}</span>
                        </Button>
                      </li>
                    );
                  })}
                  {people.truncated ? <li className="text-xs text-text-muted">More people match; type more of the name.</li> : null}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Oathweave role" hint="Everyone whose Oathweave token carries it, directly or through a group">
                  <TextInput value={roleName} onChange={setRoleName} maxLength={128} />
                </Field>
                <Button
                  size="sm"
                  disabled={!roleName.trim()}
                  onClick={() => {
                    add({ member: { kind: 'oathweave_role', name: roleName.trim(), role: 'viewer' }, label: `Oathweave role ${roleName.trim()}` });
                    setRoleName('');
                  }}
                >
                  Add role
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
    </Drawer>
  );
}
