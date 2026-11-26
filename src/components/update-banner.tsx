import { useEffect, useState } from 'react';
import { reloadConsole } from '../lib/chunk-reload';
import { watchVersion, type ConsoleVersion } from '../lib/version-watch';
import { Button } from './ui';
import { Icon } from './icons';

/** "A new HiveXUI version is available" after an upgrade, with Reload, for a tab left open. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<ConsoleVersion | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => watchVersion({ onUpdate: setUpdate }), []);
  if (!update || dismissed) return null;
  return (
    <div className="update-banner sync-warning" role="status">
      <Icon.Refresh aria-hidden="true" />
      <div>
        <strong>{update.version ? `HiveXUI ${update.version} is available` : 'A new HiveXUI version is available'}</strong>
        <span>Reload to use it. Unsaved changes on this page are lost.</span>
      </div>
      <Button variant="primary" size="sm" onClick={() => reloadConsole()}>
        Reload
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        Later
      </Button>
    </div>
  );
}
