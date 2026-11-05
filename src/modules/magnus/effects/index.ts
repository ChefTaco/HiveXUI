// Every reusable visual effect of the Magnus console. See PORTING.md for what replaces what.
export { AnimatedNumber } from './animated-number';
export { LazyAreaChart, type AreaSeries } from './charts/lazy-area-chart';
export { FleetRadar, type FleetRadarCounts } from './fleet-radar';
export { Gauge } from './gauge';
export { applyStoredFxLevel, prefersReducedMotion, toggleFxLevel, useReducedMotion } from './motion';
export { Sparkline, TileTrend } from './sparkline';
export { FxMeter, FxPanel, HaloDot, MagnusMark, PageItem, ScanPanel } from './surfaces';
export { Ticker, type TickerItem } from './ticker';
export { DEFAULT_THRESHOLDS, GLOW_TEXT, latencyTone, thresholdTone, TONE_COLOR, TONE_TEXT, type Thresholds } from './tones';
export { series, useSessionSamples, type SessionSample } from './use-session-samples';
