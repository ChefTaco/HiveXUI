import { Drawer } from '@ui';
import { NewAgentWizard } from '../../magnus/pages/agents/ardent/profiles/new-agent';

/**
 * New agent for a role: Magnus's New Agent wizard in a drawer. The role is bound only when the
 * deploy has finished and its ready probe answered, which is when the wizard offers its done button.
 */
export function NewAgentDrawer({
  open,
  roleName,
  onDeployStarted,
  onCreated,
  onClose,
}: {
  open: boolean;
  roleName: string;
  onDeployStarted: (agentRef: string) => void;
  onCreated: (agentRef: string) => void;
  onClose: () => void;
}) {
  return (
    <Drawer open={open} title={`New agent for ${roleName}`} eyebrow="Magnus · New Agent" onClose={onClose}>
      {open ? <NewAgentWizard onDone={onCreated} onCancel={onClose} onDeployStarted={onDeployStarted} doneLabel={`Bind to ${roleName}`} /> : null}
    </Drawer>
  );
}
