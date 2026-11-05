import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { readRegistryCatalog, useRegistry, type RegistryEntry } from '../lib/registry';
import { registryEntryPresented } from '../lib/runtime';
import { Badge, IconButton, Panel } from './ui';

function CopyUrl({ name, url }: { name: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="stat-label">{name}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-control border border-border bg-surface-sunken pl-3">
        <code className="min-w-0 flex-1 font-mono text-sm text-text [overflow-wrap:anywhere]">{url}</code>
        <IconButton
          label={`Copy the ${name} API URL`}
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              },
              () => {},
            );
          }}
        />
      </div>
    </div>
  );
}

function ProductLink({ href, label, product }: { href: string | null; label: string; product: string }) {
  if (!href) return null;
  return (
    <a className="inline-flex items-center gap-1 text-sm text-accent" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${product}: ${label}`}>
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

function ProductTile({ entry: { product, connection } }: { entry: RegistryEntry }) {
  const apis = Object.entries(connection?.nativeApis ?? {});
  return (
    <article className="product-tile content-start">
      <div className="product-tile__row">
        <h4 className="product-tile__name">{product.displayName}</h4>
        {product.required ? <Badge>Required</Badge> : null}
      </div>
      {product.description ? <p className="text-sm text-text-muted">{product.description}</p> : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <ProductLink href={product.links.documentation} label="Documentation" product={product.displayName} />
        <ProductLink href={product.links.repository} label="Repository" product={product.displayName} />
        <ProductLink href={product.links.license} label={product.links.licenseSpdx ?? 'License'} product={product.displayName} />
      </div>
      {apis.map(([name, url]) => <CopyUrl key={name} name={name} url={url} />)}
      {connection ? null : <p className="text-sm text-text-muted">Its API addresses could not be loaded.</p>}
    </article>
  );
}

/** Installed products' public links from the Registry. Says nothing when the Registry is unusable. */
export function RegistryProducts({ title }: { title: string }) {
  const registry = useRegistry();
  const key = registry.status === 'ready' ? [...registry.installed].sort().join() : null;
  const [catalog, setCatalog] = useState<{ key: string; entries: RegistryEntry[] | null } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let active = true;
    void readRegistryCatalog(registryEntryPresented).then(
      (entries) => { if (active) setCatalog({ key, entries }); },
      () => { if (active) setCatalog({ key, entries: null }); },
    );
    return () => { active = false; };
  }, [key]);
  if (key === null) return null;
  const current = catalog?.key === key ? catalog : null;
  return (
    <Panel title={title} eyebrow="Hive Registry">
      {current === null ? (
        <p role="status" className="text-sm text-text-muted">Loading product links.</p>
      ) : current.entries === null ? (
        <p role="status" className="warning-banner">Product links could not be loaded from the Hive Registry.</p>
      ) : (
        <div className="product-grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
          {current.entries.map((entry) => <ProductTile key={entry.product.id} entry={entry} />)}
        </div>
      )}
    </Panel>
  );
}
