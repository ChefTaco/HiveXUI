import type { ComponentType } from 'react';

export type ConsoleRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';
/** A server setting from GET /console/session. Sections and routes tied to it stay hidden when off. */
export type MagnusCapability = 'hermes';

export interface MagnusRoute {
  /** The old console's path, with :name for a parameter: '/nodes/:nodeId'. Never include /fleet. */
  path: string;
  /** Shown in the top bar. */
  title: string;
  /** Always a dynamic import, so each page is its own chunk. */
  load: () => Promise<{ default: ComponentType }>;
  /** Roles that may open it. Leave out when every role may. */
  roles?: readonly ConsoleRole[];
  capability?: MagnusCapability;
}
