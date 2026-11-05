import type { Tone } from '@ui';

interface RunCounts {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
}

export const convergencePercent = ({ totalNodes, completedNodes, failedNodes }: RunCounts): number => (totalNodes ? Math.round(((completedNodes + failedNodes) / totalNodes) * 100) : 0);

export const canPause = (status: string): boolean => status === 'running';
export const canResume = (status: string): boolean => status === 'paused';
export const canAbort = (status: string): boolean => ['running', 'paused', 'created'].includes(status);

export const statusColor = (status: string): Tone => (status === 'failed' ? 'danger' : status === 'completed' ? 'success' : 'warning');
export const abortMessage = (id: string): string => `Abort rollout ${id}? Pending targets will be cancelled.`;

/** The bar: failures show first, otherwise it reads as progress. */
export const convergenceTone = ({ failedNodes, totalNodes, completedNodes }: RunCounts): Tone => (failedNodes > 0 ? 'danger' : totalNodes > 0 && completedNodes === totalNodes ? 'success' : 'accent');
