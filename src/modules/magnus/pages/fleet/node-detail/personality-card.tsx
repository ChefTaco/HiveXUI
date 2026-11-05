import { useMemo } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { nodeHealthHistoryResponseSchema } from '@contracts/magnus/browser';
import { Badge, IconButton } from '@ui';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, Sparkline } from '../../../effects';
import { computePersonality } from './personality';

const SAMPLES = 100;
const TREND_POINTS = 40;

export function NodePersonalityCard({ node }: { node: { id: string; hostname: string; status: string; lastHeartbeatAt: string | null } }) {
  const history = useMagnusResource((signal) => magnus.get(`/nodes/${segment(node.id)}/health/history`, nodeHealthHistoryResponseSchema, { query: { limit: SAMPLES }, signal }), [node.id]);
  // Newest first on the wire. Reversed so the trend reads left to right.
  const snapshots = useMemo(() => [...(history.data?.data ?? [])].reverse(), [history.data]);
  const personality = useMemo(() => computePersonality(node, snapshots), [node, snapshots]);
  const { archetype, stats } = personality;
  return (
    <FxPanel fxTone="info" title="Personality" actions={<IconButton label="Refresh personality" icon={<RefreshCw className="size-4" />} onClick={() => void history.refresh()} />}>
      <div className="flex flex-col gap-4" data-archetype={personality.archetypeKey}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-pill border border-info bg-surface-sunken text-2xl shadow-[0_0_16px_var(--glow-info)]">{archetype.emoji}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone={archetype.tone}>{archetype.name}</Badge>
                {history.loading ? <span className="text-xs text-text-muted">analyzing…</span> : null}
              </div>
              <p className="m-0 mt-1 text-sm text-text-muted">{archetype.description}</p>
            </div>
          </div>
          <Sparkles aria-hidden="true" className="mt-1 size-4 shrink-0 text-info" />
        </div>
        <blockquote className="m-0 border-l-2 border-info pl-3 text-sm italic">“{personality.bio}”</blockquote>
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-3">
          <Trend title="CPU trend" average={stats.cpuAvg} values={snapshots.map((snapshot) => snapshot.cpuUsagePercent).slice(-TREND_POINTS)} tone="accent" />
          <Trend title="Memory trend" average={stats.memAvg} values={snapshots.map((snapshot) => snapshot.memoryPercent).slice(-TREND_POINTS)} tone="info" />
        </div>
        <div className="num flex flex-wrap items-center gap-4 text-xs text-text-muted">
          <span>{stats.samples} samples</span>
          <span>σ {stats.cpuStdDev.toFixed(1)}%</span>
          <span>{stats.spikes} spikes</span>
          {history.error ? <span className="text-warning">{errorMessage(history.error, 'History could not be loaded')}</span> : null}
        </div>
      </div>
    </FxPanel>
  );
}

function Trend({ title, average, values, tone }: { title: string; average: number; values: number[]; tone: 'accent' | 'info' }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2">
        <span className="text-xs text-text-muted">{title}</span>
        <span className="num text-xs text-text-muted">avg {average.toFixed(0)}%</span>
      </div>
      <Sparkline values={values} tone={tone} percent stretch threshold={80} label={`${title}, average ${average.toFixed(0)}%`} />
    </div>
  );
}
