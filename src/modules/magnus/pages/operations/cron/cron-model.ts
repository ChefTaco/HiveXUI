export interface ScannedJob {
  user: string;
  name: string;
  schedule: string;
  command: string;
}

export function describeSchedule(schedule: string): string {
  const parts = schedule.split(/\s+/);
  if (parts.length < 5) return schedule;
  const [min, hour, dom, mon, dow] = parts;
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour';
  if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') return 'Daily at midnight';
  if (min?.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
  if (hour?.startsWith('*/')) return `Every ${hour.slice(2)} hours`;
  return schedule;
}

export function jobMatches(job: ScannedJob, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return job.name.toLowerCase().includes(needle) || job.command.toLowerCase().includes(needle) || job.schedule.toLowerCase().includes(needle) || job.user.toLowerCase().includes(needle);
}

/** Open the nodes that have jobs. If none has, open them all to show the empty listings. */
export function initiallyExpanded(results: ReadonlyArray<{ nodeId: string; jobs: readonly unknown[] }>): Set<string> {
  const withJobs = results.filter((result) => result.jobs.length > 0).map((result) => result.nodeId);
  return new Set(withJobs.length > 0 ? withJobs : results.map((result) => result.nodeId));
}

/** The library file a discovered job is published as. */
export function publishBody(job: ScannedJob, version: string, description: string) {
  return {
    name: `${job.name} v${version}`,
    fileName: `${job.name}-${version}.json`,
    mimeType: 'application/x-magnus-cronjob',
    content: JSON.stringify({ name: job.name, version, schedule: job.schedule, command: job.command, description }, null, 2),
    tags: ['cronjob', 'cron'],
  };
}
