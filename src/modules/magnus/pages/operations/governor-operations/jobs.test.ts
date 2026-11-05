import { describe, expect, it } from 'vitest';
import { createJobBody, describeSchedule, displayName, isSkillJob, nextStatus, skillCommand } from './job-model';

describe('skill jobs', () => {
  it('finds them by their prefix, and hides the prefix', () => {
    expect(isSkillJob({ name: '[AI] Log analyzer' })).toBe(true);
    expect(isSkillJob({ name: 'nightly' })).toBe(false);
    expect(displayName('[AI] Log analyzer')).toBe('Log analyzer');
  });
  it('names a preset schedule and leaves others as written', () => {
    expect(describeSchedule('0 * * * *')).toBe('Every hour');
    expect(describeSchedule('5 4 * * *')).toBe('5 4 * * *');
    expect(describeSchedule('__custom__')).toBe('__custom__');
  });
  it('builds the command from the skill, with the default entry point', () => {
    expect(skillCommand('logs', 'scan.sh')).toBe('~/.magnus/skills/logs/scan.sh');
    expect(skillCommand('logs', undefined)).toBe('~/.magnus/skills/logs/run.sh');
  });
  it('toggles the status the API reports', () => {
    expect(nextStatus('ACTIVE')).toBe('PAUSED');
    expect(nextStatus('PAUSED')).toBe('ACTIVE');
  });
  it('creates the job the old console created', () => {
    expect(createJobBody({ name: ' Log analyzer ', nodeId: 'n', skill: 'logs', entryPoint: undefined, schedule: ' 0 * * * * ' })).toEqual({
      name: '[AI] Log analyzer',
      description: 'Scheduled analysis job: run logs skill',
      nodeId: 'n',
      schedule: '0 * * * *',
      command: '~/.magnus/skills/logs/run.sh',
      args: [],
      timeoutSeconds: 300,
    });
  });
});
