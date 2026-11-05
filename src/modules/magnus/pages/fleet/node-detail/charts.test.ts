import { describe, expect, it } from 'vitest';
import { chartPoints } from './gpu-card';
import { mergeSeries } from './metrics-chart';
import { forecastLabel, forecastTone } from './posture-cards';

describe('the CPU and memory history', () => {
  it('joins the two series on time, in order, and keeps a sample only one has', () => {
    const rows = mergeSeries(
      { timestamps: ['2026-11-05T10:01:00Z', '2026-11-05T10:00:00Z'], values: [2, 1] },
      { timestamps: ['2026-11-05T10:00:00Z', '2026-11-05T10:02:00Z'], values: [5, 6] },
    );
    expect(rows.map(({ cpu, mem }) => [cpu, mem])).toEqual([[1, 5], [2, null], [null, 6]]);
  });
});

describe('the GPU chart', () => {
  const point = (sampledAt: string, maxUtilizationPercent: number | null) => ({ sampledAt, sampleIntervalSeconds: 30, status: 'ok' as const, devices: [], maxUtilizationPercent, maxFanPercent: null });
  it('spreads samples by time, clamps values and skips a missing reading', () => {
    const points = chartPoints([point('2026-11-05T10:00:00Z', 0), point('2026-11-05T10:01:00Z', null), point('2026-11-05T10:02:00Z', 150)], (item) => item.maxUtilizationPercent);
    expect(points).toBe('0.0,104.0 600.0,16.0');
  });
  it('draws nothing with no readings', () => {
    expect(chartPoints([], (item) => item.maxFanPercent)).toBe('');
  });
});

describe('the capacity forecast', () => {
  it('warns as a volume nears full', () => {
    expect(forecastTone(14)).toBe('danger');
    expect(forecastTone(30)).toBe('warning');
    expect(forecastTone(31)).toBe('neutral');
    expect(forecastTone(null)).toBe('neutral');
  });
  it('says what it knows', () => {
    expect(forecastLabel({ daysUntilFull: 9, growthRatePerDay: 1 })).toBe('9d to full');
    expect(forecastLabel({ daysUntilFull: null, growthRatePerDay: 1 })).toBe('trend uncertain');
    expect(forecastLabel({ daysUntilFull: null, growthRatePerDay: 0 })).toBe('stable/shrinking');
  });
});
