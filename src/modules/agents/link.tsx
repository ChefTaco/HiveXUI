// A link to an agent's Agent 360 page, for the pages that know an agent reference. Imports only the
// route table, so a page can show it without loading Agent 360 itself.
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { buttonClass } from '@ui';
import { RouteLink } from '../../components/route-link';
import { linkTo, gateOpen, routeFor } from '../../lib/routes';
import { productInstalled } from '../../lib/runtime';
import { parseAgentRef } from './paths';

/** The Agent 360 address for a reference, or null when the reference is malformed. */
export function agentPageHref(agentRef: string | null | undefined): string | null {
  const parsed = parseAgentRef(agentRef);
  return parsed ? linkTo('agents', 'agent', { agentRef: parsed.agentRef }) : null;
}

/** Whether this installation has Agent 360: any product it reads is installed. */
export const agentPageOffered = (): boolean => gateOpen(routeFor('agents')?.gate, productInstalled);

/**
 * "Agent 360" as a small button, or nothing for a malformed reference or an installation without
 * the page. `render` replaces the default link, for a surface with its own link component.
 */
export function AgentPageLink({ agentRef, className, children = 'Agent 360', render }: {
  agentRef: string | null | undefined;
  className?: string;
  children?: ReactNode;
  render?: (href: string) => ReactNode;
}) {
  const href = agentPageHref(agentRef);
  if (!href || !agentPageOffered()) return null;
  if (render) return <>{render(href)}</>;
  return (
    <RouteLink href={href} className={buttonClass({ size: 'sm', className: `no-underline ${className ?? ''}`.trim() })}>
      {children}
      <ArrowUpRight className="btn-ico" aria-hidden="true" />
    </RouteLink>
  );
}
