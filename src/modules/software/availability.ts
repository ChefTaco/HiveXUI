// Whether this installation can show Installed software: suite sign-in, and a Hive Registry that
// announces its signed-in inventory read. The first positive answer enables the Registry sign-in.
import { useEffect, useState } from 'react';
import { registryAnnouncesInventory } from '../../lib/registry';
import { browserIdentity, enableRegistryInventory, productEnabled } from '../../lib/runtime';

export async function inventoryAvailable(): Promise<boolean> {
  if (!browserIdentity()) return false;
  if (productEnabled('hive-registry')) return true;
  if (!(await registryAnnouncesInventory())) return false;
  return enableRegistryInventory() && productEnabled('hive-registry');
}

/** Null while asking. */
export function useInventoryAvailable(ask = true): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(ask ? null : false);
  useEffect(() => {
    if (!ask) return setAvailable(false);
    let active = true;
    void inventoryAvailable().then((value) => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, [ask]);
  return available;
}
