import { Drawer } from '@ui';
import { NewAgentWizard } from '../../magnus/pages/agents/ardent/profiles/new-agent';

/**
 * Magnus's New Agent wizard in a drawer: for a role, or on its own from the requirement gate. A role
 * is bound only when the deploy has finished and its ready probe answered, which is when the wizard
 * offers its done button.
 */
export function NewAgentDrawer({
  open,
  roleName,
  onDeployStarted,
  onCreated,
  onClose,
}: {
  open: boolean;
  /** The role the agent is for. Without one the drawer just creates an agent. */
  roleName?: string | undefined;
  onDeployStarted?: ((agentRef: string) => void) | undefined;
  onCreated: (agentRef: string) => void;
  onClose: () => void;
}) {
  return (
    <Drawer open={open} title={roleName ? `New agent for ${roleName}` : 'New Ardent agent'} eyebrow="Magnus · New Agent" onClose={onClose}>
      {open ? <NewAgentWizard onDone={onCreated} onCancel={onClose} onDeployStarted={onDeployStarted} doneLabel={roleName ? `Bind to ${roleName}` : 'Done'} /> : null}
    </Drawer>
  );
}
