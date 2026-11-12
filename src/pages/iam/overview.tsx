import { can } from '../../lib/permissions';
import { Badge, Panel, StatCard } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { EntityTable } from './shared';
import type { IamOps } from './use-iam-operations';

export function OverviewSection({ ops }: { ops: IamOps }) {
  const {
    currentUser,
    users,
    serviceAccounts,
    clients,
    sessions,
    auditStats,
    health,
    canRevokeSessions,
    activeUsers,
    activeTechnical,
    activeBots,
    activeSessions,
  } = ops;
  const status = String(health?.status ?? 'unknown');
  return (
    <>
      <div className="stats-grid">
        <StatCard
          label="Login Users"
          value={
            can(currentUser, 'iam:users:read') ? users.length : 'Unavailable'
          }
          sub={
            can(currentUser, 'iam:users:read')
              ? `${activeUsers} active`
              : 'Permission required'
          }
          tone="accent"
        />
        <StatCard
          label="Service Accounts"
          value={
            can(currentUser, 'iam:sa:read')
              ? serviceAccounts.length
              : 'Unavailable'
          }
          sub={
            can(currentUser, 'iam:sa:read')
              ? `${activeTechnical} active`
              : 'Permission required'
          }
          tone="accent"
        />
        <StatCard
          label="Clients"
          value={
            can(currentUser, 'iam:clients:read')
              ? clients.length
              : 'Unavailable'
          }
          sub={
            can(currentUser, 'iam:clients:read')
              ? `${activeBots} active`
              : 'Permission required'
          }
          tone="accent"
        />
        <StatCard
          label="Active Sessions"
          value={canRevokeSessions ? activeSessions : 'Unavailable'}
          sub={
            auditStats
              ? `${auditStats.totalEvents} audit events / 30d`
              : 'Audit summary unavailable'
          }
          tone="accent"
        />
      </div>
      <div className="page-grid page-grid--2">
        <Panel title="IAM Core" eyebrow="Health">
          <Badge
            tone={
              status === 'healthy'
                ? 'success'
                : status === 'unknown'
                  ? 'neutral'
                  : 'danger'
            }
            dot
          >
            {status}
          </Badge>
        </Panel>
        <Panel title="Recent sessions" eyebrow="Access">
          <EntityTable
            label="Active sessions"
            empty="No active sessions."
            headers={['User', 'IP', 'Created', 'Expires']}
          >
            {sessions.slice(0, 5).map((session) => (
              <tr key={session.id}>
                <td>{session.user?.email ?? session.userId}</td>
                <td className="cell-mono">{session.ipAddress ?? '-'}</td>
                <td>{relativeTime(session.createdAt)}</td>
                <td>{relativeTime(session.expiresAt)}</td>
              </tr>
            ))}
          </EntityTable>
        </Panel>
      </div>
    </>
  );
}
