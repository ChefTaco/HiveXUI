import type { ReactNode } from 'react';
import type { AdminUser } from '../../lib/types';
import { browserIdentity } from '../../lib/runtime';
import { can } from '../../lib/permissions';
import { Badge, Button, CopyField, Panel, PageHeader } from '../../components/ui';
import { Icon } from '../../components/icons';
import { SECTION_LABELS, type IamSection } from './shared';
import { useIamOperations, type IamOps } from './use-iam-operations';
import { OverviewSection } from './overview';
import { UsersSection } from './users';
import { RolesSection } from './roles';
import { ServiceAccountsSection } from './service-accounts';
import { ClientsSection } from './clients';
import { SessionsSection } from './sessions';
import { SystemUsersSection } from './system-users';
import { SecuritySection } from './security';
import { AuditSection } from './audit';

export type { IamSection } from './shared';

const SECTIONS: Record<IamSection, (props: { ops: IamOps }) => ReactNode> = {
  overview: OverviewSection,
  users: UsersSection,
  roles: RolesSection,
  'service-accounts': ServiceAccountsSection,
  clients: ClientsSection,
  sessions: SessionsSection,
  'system-users': SystemUsersSection,
  security: SecuritySection,
  audit: AuditSection,
};
/** What a section needs to be shown at all. The overview and security pages check per panel. */
const READ_PERMISSION: Partial<Record<IamSection, string>> = {
  users: 'iam:users:read',
  roles: 'iam:roles:read',
  'service-accounts': 'iam:sa:read',
  clients: 'iam:clients:read',
  sessions: 'iam:sessions:revoke',
  'system-users': 'iam:system:login',
  audit: 'iam:audit:read',
};

export function IamOperationsPage({
  section = 'overview',
  onNavigate,
  currentUser,
}: {
  section?: IamSection;
  onNavigate?: (view: string) => void;
  currentUser: AdminUser | null;
}) {
  const ops = useIamOperations(section, currentUser);
  const { confirmDialog, loadIam, loading, error, notice, revealedSecret } = ops;
  return (
    <>
      {confirmDialog}
      <PageHeader
        title={SECTION_LABELS[section]}
        description="Identity, access, service credentials, sessions, and audit controls."
        actions={<Badge tone="success" dot>
          {browserIdentity() ? 'Oathweave sign-in' : 'Console sign-in'}
        </Badge>}
      />

      <div className="ops-toolbar">
        <nav className="segmented-tabs" aria-label="IAM sections">
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={
                section === key ? 'tab-button tab-button--active' : 'tab-button'
              }
              aria-current={section === key ? 'page' : undefined}
              onClick={() => onNavigate?.(`iam-${key}`)}
            >
              {label.replace('IAM ', '')}
            </button>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadIam()}
          loading={loading}
          icon={<Icon.Refresh className="btn-ico" />}
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="error-banner">
          <Icon.Alert />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="success-banner">
          <Icon.Check />
          {notice}
        </div>
      ) : null}
      {revealedSecret ? (
        <Panel title="Secret shown once" eyebrow="Store now">
          <CopyField value={revealedSecret} />
        </Panel>
      ) : null}

      <SectionContent ops={ops} />
    </>
  );
}

function SectionContent({ ops }: { ops: IamOps }) {
  const permission = READ_PERMISSION[ops.section];
  if (permission && !can(ops.currentUser, permission))
    return (
      <Panel title="Access unavailable">
        <p>Your identity does not have permission to inspect this section.</p>
      </Panel>
    );
  const Section = SECTIONS[ops.section];
  return <Section ops={ops} />;
}
