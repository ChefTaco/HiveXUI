import { useEffect, useState, type ReactNode } from 'react';
import type { MemoryProfile } from '../../contracts/hivemem.generated';
import { memoryApi } from '../lib/memory-api';
import { browserIdentity } from '../lib/runtime';
import { Button, Panel } from './ui';
export function MemoryAccess({
  children,
}: {
  children: (profile: MemoryProfile) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0),
    [profile, setProfile] = useState<MemoryProfile | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setProfile(null);
    setError('');
    void memoryApi
      .profile()
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : 'Memory access unavailable',
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (error)
    return (
      <Panel title="Memory access unavailable">
        <p role="alert">{error}</p>
        <Button
          onClick={() => {
            browserIdentity()?.retryConsent();
            setAttempt((value) => value + 1);
          }}
        >
          Retry access
        </Button>
      </Panel>
    );
  if (!profile) return <p role="status">Checking memory access…</p>;
  return children(profile);
}
