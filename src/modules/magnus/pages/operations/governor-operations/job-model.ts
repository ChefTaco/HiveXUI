/** Existing scheduled analysis jobs use this compatibility prefix. */
export const AI_JOB_PREFIX = '[AI]';

export const CUSTOM_SCHEDULE = '__custom__';
export const DEFAULT_SCHEDULE = '0 * * * *';
export const SCHEDULE_PRESETS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour', value: DEFAULT_SCHEDULE },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Custom…', value: CUSTOM_SCHEDULE },
];

export function describeSchedule(schedule: string): string {
  const found = SCHEDULE_PRESETS.find((preset) => preset.value === schedule);
  return found && found.value !== CUSTOM_SCHEDULE ? found.label : schedule;
}

export const isSkillJob = (job: { name: string }): boolean => job.name.startsWith(AI_JOB_PREFIX);
export const displayName = (name: string): string => name.replace(/^\[AI\]\s*/, '');
export const skillCommand = (skill: string, entryPoint: string | undefined): string => `~/.magnus/skills/${skill}/${entryPoint ?? 'run.sh'}`;

/** What a toggle changes the job to. The API reports upper case, which the old page's comparison missed. */
export const nextStatus = (status: string): 'ACTIVE' | 'PAUSED' => (status.toUpperCase() === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');

export function createJobBody(input: { name: string; nodeId: string; skill: string; entryPoint: string | undefined; schedule: string }) {
  return {
    name: `${AI_JOB_PREFIX} ${input.name.trim()}`,
    description: `Scheduled analysis job: run ${input.skill} skill`,
    nodeId: input.nodeId,
    schedule: input.schedule.trim(),
    command: skillCommand(input.skill, input.entryPoint),
    args: [],
    timeoutSeconds: 300,
  };
}
