import { useCallback, useRef } from 'react';
import { magnus } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { codexInstallationsResponseSchema } from './schemas';

/** The fleet's cached Codex state. `refreshLatest` also asks for the newest published release. */
export function useCodexFleet() {
  const latest = useRef(false);
  const resource = useMagnusResource((signal) => magnus.get('/codex/installations', codexInstallationsResponseSchema, { query: { refreshLatest: latest.current ? 'true' : undefined }, signal }).then((response) => response.data));
  const { refresh } = resource;
  const refreshLatest = useCallback(async () => {
    latest.current = true;
    await refresh();
    latest.current = false;
  }, [refresh]);
  return { ...resource, refreshLatest };
}
