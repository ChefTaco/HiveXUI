import type { ReactNode } from 'react';
import { Bot, MousePointerClick, Puzzle, Search } from 'lucide-react';
import { Badge, Drawer, statusTone, TableFrame, type Tone } from '@ui';
import { formatTime } from '@lib/format';
import { FxPanel } from '../../../effects';
import { detectedPlugins, findPluginLabel, hermesDashboardAddress, skillSummary, type HermesInstallation, type HermesSkill } from './node-data';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="m-0 mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}
const code = 'font-mono text-xs break-all';

function HiveMemTokenStatus({ configuration }: { configuration: NonNullable<HermesInstallation['configuration']> }) {
  if (configuration.memoryProvider !== 'hivemem') return null;
  const token = configuration.hiveMemToken;
  const status = token?.status ?? 'unknown';
  const tone: Tone = status === 'valid' ? 'success' : status === 'expiring' || status === 'unreachable' || status === 'unknown' ? 'warning' : 'danger';
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <Badge tone={tone}>Token {status}</Badge>
      {token?.expiresAt ? <time dateTime={token.expiresAt} title="HiveMem token expiration">expires {formatTime(token.expiresAt)}</time> : null}
      {token?.checkedAt ? <time dateTime={token.checkedAt} className="text-text-muted" title="Last HiveMem authentication check">checked {formatTime(token.checkedAt)}</time> : null}
    </span>
  );
}

/**
 * What the node's Hermes Agent reports. Its dashboard address is shown, not opened: nothing from a node is
 * embedded in the console. Deployment from here is gone, because POST /hermes/deploy is retired.
 */
export function HermesCard({ installation, skills, onShowSkills }: { installation: HermesInstallation | null; skills: readonly HermesSkill[]; onShowSkills: () => void }) {
  if (!installation) {
    return (
      <FxPanel title="Hermes Agent" description="No Hermes Agent installed or found">
        <p className="m-0 text-sm text-text-muted">No Hermes Agent is installed or currently detected on this node.</p>
      </FxPanel>
    );
  }
  const configuration = installation.configuration;
  const provider = configuration?.modelProvider ?? 'unknown';
  const plugins = detectedPlugins(installation);
  return (
    <FxPanel title="Hermes Agent" description={installation.displayName ?? installation.hostname} actions={<Badge tone={statusTone(installation.status)}>{installation.status}</Badge>}>
      <div className="grid gap-4">
        <dl className="m-0 grid gap-3 sm:grid-cols-2">
          <Item label="Version"><span className={code}>{installation.version ?? 'unknown'}</span></Item>
          <Item label="Home"><span className={code}>{installation.hermesHome}</span></Item>
          <Item label="Dashboard">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(installation.dashboardStatus)}>{installation.dashboardStatus}</Badge>
              <span className={code}>{hermesDashboardAddress(installation)}</span>
            </span>
          </Item>
          <Item label="Gateway"><Badge tone={statusTone(installation.gatewayStatus)}>{installation.gatewayStatus}</Badge></Item>
          <Item label="API server"><span className={code}>{installation.apiServerEnabled ? `${installation.apiServerHost}:${installation.apiServerPort ?? '—'}` : 'disabled'}</span></Item>
          <Item label="Primary provider">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={provider === 'unknown' ? 'warning' : 'success'}>{provider}</Badge>
              {configuration?.magnusRouterConfigured ? <Badge tone="success">Magnus routed</Badge> : null}
            </span>
          </Item>
          <Item label="Default model"><span className={code}>{configuration?.modelName ?? 'unknown'}</span></Item>
          <Item label="OpenAI runtime"><Badge tone={configuration?.openaiRuntime === 'codex_app_server' ? 'success' : 'warning'}>{configuration?.openaiRuntime === 'codex_app_server' ? 'Codex app-server' : 'Hermes default'}</Badge></Item>
          <Item label="Web search"><span className="flex items-center gap-2"><Search aria-hidden="true" className="size-4 shrink-0 text-text-muted" /><span className={code}>{findPluginLabel(plugins, 'search')}</span></span></Item>
          <Item label="Crawling"><span className="flex items-center gap-2"><MousePointerClick aria-hidden="true" className="size-4 shrink-0 text-text-muted" /><span className={code}>{findPluginLabel(plugins, 'crawl')}</span></span></Item>
          <Item label="Memory">
            <Badge tone={configuration?.hiveMemConfigured ? 'success' : 'warning'}>{configuration?.memoryProvider ?? 'not configured'}</Badge>
            {configuration ? <HiveMemTokenStatus configuration={configuration} /> : null}
          </Item>
          <Item label="Skills">
            <button type="button" className="role-chip role-chip--button inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60" disabled={skills.length === 0} onClick={onShowSkills}>
              <Puzzle aria-hidden="true" className="size-4" />{skillSummary(skills)}
            </button>
          </Item>
          <Item label="Last sync"><span className="num text-xs">{formatTime(installation.lastSyncedAt)}</span></Item>
        </dl>
        {configuration?.modelBaseUrl ? <p className="m-0 text-xs text-text-muted">Base URL: <span className="font-mono break-all">{configuration.modelBaseUrl}</span></p> : null}
        {configuration?.configPath ? <p className="m-0 text-xs text-text-muted">Config: <span className="font-mono break-all">{configuration.configPath}</span></p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {(installation.profiles ?? []).slice(0, 6).map((profile) => <span key={profile.id} className="role-chip inline-flex items-center gap-1"><Bot aria-hidden="true" className="size-3" />{profile.name}</span>)}
          {(installation.profiles?.length ?? 0) === 0 ? <span className="text-sm text-text-muted">No profiles synced</span> : null}
        </div>
      </div>
    </FxPanel>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-control border border-border bg-surface-sunken p-3">
      <p className="m-0 text-xs text-text-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function SkillsDrawer({ open, nodeName, skills, onClose }: { open: boolean; nodeName: string; skills: readonly HermesSkill[]; onClose: () => void }) {
  const enabled = skills.filter((skill) => skill.enabled).length;
  const sources = [...new Set(skills.map((skill) => skill.source))].filter(Boolean).join(', ') || 'unknown';
  const sorted = [...skills].sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.slug.localeCompare(right.slug));
  return (
    <Drawer open={open} title="Hermes skills" eyebrow={`${enabled} enabled on ${nodeName}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Enabled"><span className="num text-lg font-semibold">{enabled}</span></Tile>
          <Tile label="Total"><span className="num text-lg font-semibold">{skills.length}</span></Tile>
          <div className="col-span-2"><Tile label="Sources"><span className="font-mono text-sm break-all">{sources}</span></Tile></div>
        </div>
        <TableFrame label="Hermes skills on this node" className="max-h-[55vh]">
          <table>
            <thead><tr><th>Skill</th><th>Category</th><th>Source</th><th>Status</th></tr></thead>
            <tbody>
              {sorted.map((skill) => (
                <tr key={`${skill.slug}-${skill.source}`} className="fx-rail">
                  <td className="font-mono">{skill.slug}</td>
                  <td className="text-text-muted">{skill.category ?? 'uncategorized'}</td>
                  <td className="text-text-muted">{skill.source}</td>
                  <td><Badge tone={skill.enabled ? 'success' : 'neutral'}>{skill.enabled ? 'enabled' : 'disabled'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </div>
    </Drawer>
  );
}
