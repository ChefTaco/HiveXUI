// The HiveSkills catalog beside an Ardent agent's skills: search the catalog, pick a skill and install
// its promoted release onto the agent. Magnus fetches the release from its own registry, checks it
// against the catalog digest and installs it (skill-install); the console never sends skill bytes.
import { useEffect, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { cn } from '@lib/cn';
import { Badge, Button, TextInput, Toggle } from '@ui';
import { productInstalled } from '../../../../../../lib/runtime';
import { skillsApi, type CatalogEntry } from '../../../../../skills/api';
import { useMagnusResource } from '../../../../api/use-resource';
import { errorMessage } from '../../../../api/errors';
import { FxPanel } from '../../../../effects';
import type { SkillInstallResult } from '../schemas';
import { installBlockedReason, installFailure, installOutcome, matchCatalog, type SkillInstallRequest } from './skill-catalog-logic';

export interface SkillCatalogProps {
  /** The agent's skills, to mark the ones already present. */
  installed: readonly { name: string }[];
  /** The configuration revision an install that enables the skill is based on. */
  revision: string;
  /** The node agent's studio level, or null while it is not known. */
  studioLevel: number | null;
  nodeName?: string | undefined;
  install: (request: SkillInstallRequest) => Promise<SkillInstallResult>;
  onInstalled?: (result: SkillInstallResult) => void;
  className?: string;
}

export function SkillCatalog({ installed, revision, studioLevel, nodeName, install, onInstalled, className }: SkillCatalogProps) {
  const available = productInstalled('hiveskills');
  const catalog = useMagnusResource(() => skillsApi.catalog(), [], { enabled: available });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [entryError, setEntryError] = useState('');
  const [enable, setEnable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setEntry(null);
    setEntryError('');
    skillsApi.catalogEntry(selected).then(
      (value) => { if (live) setEntry(value); },
      (caught: unknown) => { if (live) setEntryError(errorMessage(caught, 'The catalog entry could not be read')); },
    );
    return () => { live = false; };
  }, [selected]);

  if (!available) return null;
  const blocked = installBlockedReason(studioLevel, nodeName);
  const names = new Set(installed.map((skill) => skill.name));
  const matches = matchCatalog(catalog.data ?? [], query);
  const release = entry?.slug === selected ? entry.release : null;

  async function run() {
    if (!entry?.release) return;
    setBusy(true);
    setError('');
    setOutcome(null);
    try {
      const result = await install({ source: 'hiveskills', name: entry.slug, version: entry.release.version, ...(enable ? { enable: true, revision } : {}) });
      setOutcome(installOutcome(result));
      onInstalled?.(result);
    } catch (caught) {
      setError(installFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn('grid gap-3', className)} aria-labelledby="skill-catalog-title">
      <div>
        <h4 id="skill-catalog-title" className="m-0 text-sm font-semibold text-text-strong">HiveSkills catalog</h4>
        <p className="m-0 mt-1 text-xs text-text-muted">Install a released skill onto this agent. Magnus fetches the release from its HiveSkills registry and checks it against the catalog digest.</p>
      </div>
      {blocked ? <p role="status" className="m-0 text-sm text-warning">{blocked}</p> : null}
      <label className="relative block">
        <span className="sr-only">Search the HiveSkills catalog</span>
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <TextInput className="w-full pl-8" type="search" value={query} onChange={setQuery} placeholder="Search skills" aria-label="Search the HiveSkills catalog" />
      </label>
      {catalog.error && !catalog.data ? <p role="alert" className="m-0 text-sm text-danger">The catalog could not be read: {errorMessage(catalog.error)}</p> : null}
      {catalog.loading && !catalog.data ? <p className="m-0 text-sm text-text-muted">Reading the catalog…</p> : null}
      {catalog.data && !matches.length ? <p className="m-0 text-sm text-text-muted">{catalog.data.length ? 'No catalog skill matches.' : 'The catalog has no skills.'}</p> : null}
      {matches.length ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Catalog skills">
          {matches.map((skill) => (
            <li key={skill.slug}>
              <FxPanel padding="sm" className={cn('min-w-0', selected === skill.slug && 'ring-1 ring-accent')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 font-semibold">{skill.name}</p>
                    <p className="m-0 font-mono text-xs text-text-muted">{skill.slug}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {names.has(skill.slug) ? <Badge tone="info">On this agent</Badge> : null}
                    <Button size="sm" variant={selected === skill.slug ? 'primary' : 'default'} aria-pressed={selected === skill.slug}
                      onClick={() => { setSelected(skill.slug); setOutcome(null); setError(''); }}>
                      {selected === skill.slug ? 'Chosen' : 'Choose'}
                    </Button>
                  </div>
                </div>
                {skill.description ? <p className="m-0 mt-2 text-sm text-text-muted">{skill.description}</p> : null}
              </FxPanel>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <FxPanel padding="sm" title={`Install ${selected}`} interactive={false}>
          {entryError ? <p role="alert" className="m-0 text-sm text-danger">{entryError}</p>
            : entry?.slug !== selected ? <p className="m-0 text-sm text-text-muted">Reading the release…</p>
              : !release ? <p className="m-0 text-sm text-warning">No release of {selected} is promoted on the stable channel.</p> : (
                <div className="grid gap-3">
                  <p className="m-0 text-sm">
                    Release <span className="font-mono">{release.version}</span> <span className="text-text-muted">(stable)</span>
                    <span className="ml-2 font-mono text-xs text-text-muted">sha256 {release.sha256.slice(0, 16)}</span>
                  </p>
                  {names.has(selected) ? <p className="m-0 text-xs text-text-muted">The agent has a skill of this name. Magnus replaces it only if it installed it from HiveSkills.</p> : null}
                  <Toggle checked={enable} onChange={setEnable} label="Enable after installing" />
                  <div>
                    <Button variant="primary" size="sm" icon={<Download className="size-4" />} loading={busy} disabled={!!blocked || busy} onClick={() => void run()}>Install</Button>
                  </div>
                </div>
              )}
          {outcome ? <p role="status" className={cn('m-0 mt-3 text-sm', outcome.tone === 'success' ? 'text-success' : 'text-warning')}>{outcome.text}</p> : null}
          {error ? <p role="alert" className="m-0 mt-3 break-words text-sm text-danger">{error}</p> : null}
        </FxPanel>
      ) : null}
    </section>
  );
}
