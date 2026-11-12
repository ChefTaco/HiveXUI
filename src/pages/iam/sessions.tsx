import { adminApi } from '../../lib/api';
import { Button, Panel } from '../../components/ui';
import { formatTime } from '../../lib/format';
import { EntityTable } from './shared';
import type { IamOps } from './use-iam-operations';

export function SessionsSection({ ops }: { ops: IamOps }) {
  const {
    confirmAction,
    sessions,
    canRevokeSessions,
    run,
  } = ops;
  return (
    <Panel title="Sessions" eyebrow="Active access">
      <p>Review each session before revoking it. A shared IP address or browser
        does not mean two sessions are duplicates.</p>
      <EntityTable
        label="Sessions"
        empty="No active sessions."
        headers={['User', 'IP', 'Created', 'Expires', 'Actions']}
      >
        {sessions.map((session) => (
          <tr key={session.id}>
            <td>
              <strong>{session.user?.email ?? session.userId}</strong>
              <span className="row-sub">
                {session.userAgent ?? 'No user agent'}
              </span>
            </td>
            <td className="cell-mono">{session.ipAddress ?? '-'}</td>
            <td>{formatTime(session.createdAt)}</td>
            <td>{formatTime(session.expiresAt)}</td>
            <td>
              <Button
                size="sm"
                variant="danger"
                disabled={!canRevokeSessions}
                onClick={async () => {
                  if (
                    await confirmAction({ title: 'Revoke session', message: 'Revoke this session?', confirmLabel: 'Revoke' })
                  )
                    void run(
                      () => adminApi.revokeIamSession(session.id),
                      'Session revoked',
                    );
                }}
              >
                Revoke
              </Button>
            </td>
          </tr>
        ))}
      </EntityTable>
    </Panel>
  );
}
