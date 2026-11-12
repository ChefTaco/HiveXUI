import { adminApi } from '../../lib/api';
import { Badge, Button, EmptyState, Field, Panel, StatCard, TextInput, Toggle } from '../../components/ui';
import { Icon } from '../../components/icons';
import { relativeTime } from '../../lib/format';
import { EntityTable } from './shared';
import type { IamOps } from './use-iam-operations';

export function SecuritySection({ ops }: { ops: IamOps }) {
  const {
    users,
    confirmAction,
    sessions,
    passwordPolicy,
    busy,
    canRevokeSessions,
    canWritePolicy,
    run,
    patchPasswordPolicy,
    savePasswordPolicy,
  } = ops;
  const mfaEnabled = users.filter((user) => user.mfaEnabled).length;
  const passkeyTotal = users.reduce(
    (sum, user) => sum + (user.passkeyCount ?? 0),
    0,
  );
  const trustedDeviceTotal = users.reduce(
    (sum, user) => sum + (user.trustedDeviceCount ?? 0),
    0,
  );
  const riskySessions = sessions.filter(
    (session) =>
      typeof session.riskScore === 'number' && session.riskScore >= 0.5,
  );

  return (
    <>
      <div className="stats-grid">
        <StatCard
          label="MFA Enabled"
          value={mfaEnabled}
          sub={`${users.length - mfaEnabled} without MFA`}
          tone={users.length - mfaEnabled > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Passkeys"
          value={passkeyTotal}
          sub="registered WebAuthn credentials"
          tone="accent"
        />
        <StatCard
          label="Trusted Devices"
          value={trustedDeviceTotal}
          sub="registered device fingerprints"
          tone="accent"
        />
        <StatCard
          label="Risky Sessions"
          value={riskySessions.length}
          sub="step-up candidates"
          tone={riskySessions.length ? 'danger' : 'success'}
        />
      </div>

      <div className="page-grid page-grid--2">
        <Panel title="MFA And Passkeys" eyebrow="Users">
          <EntityTable
            label="User sign-in security"
            empty="No IAM users found."
            headers={['User', 'MFA', 'Passkeys', 'Devices', 'Password']}
          >
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.displayName ?? user.username}</strong>
                  <span className="row-sub">{user.email}</span>
                </td>
                <td>
                  <Badge tone={user.mfaEnabled ? 'success' : 'warning'} dot>
                    {user.mfaEnabled ? 'enabled' : 'off'}
                  </Badge>
                </td>
                <td className="cell-mono">{user.passkeyCount ?? 0}</td>
                <td className="cell-mono">{user.trustedDeviceCount ?? 0}</td>
                <td className="cell-mono">
                  {user.passwordChangedAt
                    ? relativeTime(user.passwordChangedAt)
                    : 'unknown'}
                </td>
              </tr>
            ))}
          </EntityTable>
        </Panel>

        <Panel title="Step-Up And Risk" eyebrow="Sessions">
          <EntityTable
            label="High-risk sessions"
            empty="No high-risk sessions."
            headers={['User', 'Risk', 'Step-Up', 'Factors', 'Actions']}
          >
            {riskySessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <strong>{session.user?.email ?? session.userId}</strong>
                  <span className="row-sub">
                    {session.ipAddress ?? 'no ip'}
                  </span>
                </td>
                <td>
                  <Badge
                    tone={
                      (session.riskScore ?? 0) >= 0.75 ? 'danger' : 'warning'
                    }
                  >
                    {Math.round((session.riskScore ?? 0) * 100)}%
                  </Badge>
                </td>
                <td className="cell-mono">
                  {session.stepUpVerifiedAt
                    ? relativeTime(session.stepUpVerifiedAt)
                    : 'required'}
                </td>
                <td className="cell-mono">
                  {Array.isArray(session.riskFactors)
                    ? session.riskFactors.join(', ')
                    : (session.riskFactors ?? '-')}
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!canRevokeSessions}
                    onClick={async () => {
                      if (
                        await confirmAction({ title: 'Revoke risky session', message: 'Revoke this risky session?', confirmLabel: 'Revoke' })
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

        <Panel
          title="Password Policy"
          eyebrow="Step-up foundation"
          className="col-span-full"
        >
          {passwordPolicy ? (
            <>
              <div className="field-grid">
                <Field label="Name">
                  <TextInput
                    value={passwordPolicy.name}
                    onChange={(name) => patchPasswordPolicy({ name })}
                  />
                </Field>
                <Field label="Min length">
                  <TextInput
                    inputMode="numeric"
                    value={String(passwordPolicy.minLength)}
                    onChange={(value) =>
                      patchPasswordPolicy({ minLength: Number(value) || 0 })
                    }
                  />
                </Field>
                <Field label="Max length">
                  <TextInput
                    inputMode="numeric"
                    value={String(passwordPolicy.maxLength)}
                    onChange={(value) =>
                      patchPasswordPolicy({ maxLength: Number(value) || 0 })
                    }
                  />
                </Field>
                <Field label="Max age days">
                  <TextInput
                    inputMode="numeric"
                    value={String(passwordPolicy.maxAgeDays)}
                    onChange={(value) =>
                      patchPasswordPolicy({ maxAgeDays: Number(value) || 0 })
                    }
                  />
                </Field>
                <Field label="History count">
                  <TextInput
                    inputMode="numeric"
                    value={String(passwordPolicy.historyCount)}
                    onChange={(value) =>
                      patchPasswordPolicy({
                        historyCount: Number(value) || 0,
                      })
                    }
                  />
                </Field>
                <Field label="Lockout attempts">
                  <TextInput
                    inputMode="numeric"
                    value={String(passwordPolicy.lockoutAttempts)}
                    onChange={(value) =>
                      patchPasswordPolicy({
                        lockoutAttempts: Number(value) || 0,
                      })
                    }
                  />
                </Field>
                <Field label="Lockout minutes">
                  <TextInput
                    inputMode="numeric"
                    value={String(passwordPolicy.lockoutDurationMin)}
                    onChange={(value) =>
                      patchPasswordPolicy({
                        lockoutDurationMin: Number(value) || 0,
                      })
                    }
                  />
                </Field>
                <div className="toggle-stack">
                  <Toggle
                    checked={passwordPolicy.requireUppercase}
                    onChange={(requireUppercase) =>
                      patchPasswordPolicy({ requireUppercase })
                    }
                    label="Uppercase"
                  />
                  <Toggle
                    checked={passwordPolicy.requireLowercase}
                    onChange={(requireLowercase) =>
                      patchPasswordPolicy({ requireLowercase })
                    }
                    label="Lowercase"
                  />
                  <Toggle
                    checked={passwordPolicy.requireNumbers}
                    onChange={(requireNumbers) =>
                      patchPasswordPolicy({ requireNumbers })
                    }
                    label="Numbers"
                  />
                  <Toggle
                    checked={passwordPolicy.requireSpecial}
                    onChange={(requireSpecial) =>
                      patchPasswordPolicy({ requireSpecial })
                    }
                    label="Special characters"
                  />
                </div>
              </div>
              <div className="form-actions">
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!canWritePolicy}
                  icon={<Icon.Check className="btn-ico" />}
                  onClick={() => void savePasswordPolicy()}
                >
                  Save policy
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Icon.Alert width={34} height={34} />}
              message="Password policy could not be loaded from IAM."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
