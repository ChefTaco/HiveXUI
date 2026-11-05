import { useEffect, useState, type ReactNode } from 'react';
import { can } from '../lib/permissions';
import { adminApi } from '../lib/api';
import { browserIdentity, productEnabled } from '../lib/runtime';
import type { AdminUser } from '../lib/types';
import { Button, Panel } from './ui';
export function ProductAccess({
  product,
  fallback,
  permission,
  children,
}: {
  product: 'emberpath' | 'oathweave';
  fallback: AdminUser | null;
  permission?: string;
  children: (user: AdminUser | null) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [user, setUser] = useState<AdminUser | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (browserIdentity() && productEnabled(product))
      void adminApi
        .resourceMe(product)
        .then((value) => {
          if (active) setUser(value.user);
        })
        .catch((error) => {
          if (active)
            setError(
              error instanceof Error ? error.message : 'Product unavailable',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    else setLoading(false);
    return () => {
      active = false;
    };
  }, [product, attempt]);
  if (!browserIdentity()) return children(fallback);
  // Navigation never routes here for an absent product; render nothing rather than a trace of it.
  if (!productEnabled(product)) return null;
  if (loading) return <p role="status">Checking product access…</p>;
  if (error || !user)
    return (
      <Panel title="Product access unavailable">
        <p role="alert">{error || 'This identity has no linked account.'}</p>
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
  if (permission && !can(user, permission))
    return (
      <Panel title="Access unavailable">
        <p>
          Your product account does not have permission to inspect this section.
        </p>
      </Panel>
    );
  return children(user);
}
