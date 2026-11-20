// The page's three reads. Each fails on its own, so one product being down or older costs only
// its own panel.
import { registryInventorySchema, type RegistryInventory } from '@contracts/hive-registry/inventory';
import { nodeListResponseSchema } from '@contracts/magnus/browser';
import { failureMeta, HiveApiError, readApiFailure } from '../../lib/api-error';
import { apiFetch } from '../../lib/transport';
import { magnus } from '../magnus/api/client';
import { magnusInstallationSchema, type MagnusInstallation } from './magnus-report';
import type { AgentNode } from './compare';

export const INVENTORY_PATH = '/api/registry/v1/inventory';
/** The fleet is read in pages of 100; more than this many pages is not a fleet this page summarises. */
const MAX_NODE_PAGES = 20;

export async function readInventory(signal?: AbortSignal, request: typeof apiFetch = apiFetch): Promise<RegistryInventory> {
  const response = await request(INVENTORY_PATH, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  if (!response.ok) {
    const failure = await readApiFailure(response, {
      trustMessage: false,
      fallback: response.status === 404
        ? 'This Hive Registry does not serve the installed software inventory yet. Upgrade the installation to a release that does.'
        : response.status === 403
          ? 'Your Oathweave role does not include the Hive Registry inventory.'
          : 'The Hive Registry inventory could not be read',
    });
    throw new HiveApiError(failure.status, failure.message, { ...failureMeta(failure), code: failure.code });
  }
  const parsed = registryInventorySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new HiveApiError(502, 'The Hive Registry sent an inventory this UI cannot read');
  return parsed.data;
}

export const readMagnusInstallation = (signal?: AbortSignal): Promise<MagnusInstallation> =>
  magnus.get('/system/installation', magnusInstallationSchema, { signal });

export async function readAgentNodes(signal?: AbortSignal): Promise<AgentNode[]> {
  const nodes: AgentNode[] = [];
  for (let page = 1; page <= MAX_NODE_PAGES; page++) {
    const answer = await magnus.get('/nodes', nodeListResponseSchema, { query: { page, pageSize: 100 }, signal });
    for (const node of answer.data) nodes.push({ name: node.name, version: node.agent?.version ?? null });
    if (!answer.meta.hasMore) break;
  }
  return nodes;
}
