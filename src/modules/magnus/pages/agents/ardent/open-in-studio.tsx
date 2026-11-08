// Fleet details → Agent Studio. Shown only where the console has Ardent Project Studio; Studio opens
// over the console and its ✕ comes back to this page.
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@lib/cn';
import { productInstalled } from '../../../../../lib/runtime';
import { openStudio } from '../../../../studio/paths';
import { agentHref } from '../../../../studio/routes';

/** Whether this console has Ardent Project Studio to open. */
export const studioOffered = (): boolean => productInstalled('ardentstudio');

export function OpenInStudio({ nodeId, profileId, className }: { nodeId: string; profileId: string; className?: string }) {
  if (!studioOffered()) return null;
  const href = agentHref(`${nodeId}~${profileId}`);
  return (
    <a
      href={href}
      className={cn('btn no-underline', className)}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openStudio(href);
      }}
    >
      Open in Studio
      <ArrowUpRight className="btn-ico" aria-hidden="true" />
    </a>
  );
}
