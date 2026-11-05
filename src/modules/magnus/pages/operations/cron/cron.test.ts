import { describe, expect, it } from 'vitest';
import { describeSchedule, initiallyExpanded, jobMatches, publishBody } from './cron-model';

const job = { user: 'root', name: 'backup', schedule: '0 2 * * *', command: '/opt/backup.sh' };

describe('describeSchedule', () => {
  it('names the common schedules', () => {
    expect(describeSchedule('* * * * *')).toBe('Every minute');
    expect(describeSchedule('0 * * * *')).toBe('Every hour');
    expect(describeSchedule('0 0 * * *')).toBe('Daily at midnight');
    expect(describeSchedule('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeSchedule('0 */6 * * *')).toBe('Every 6 hours');
  });
  it('leaves the rest as written', () => {
    expect(describeSchedule('0 2 * * 1')).toBe('0 2 * * 1');
    expect(describeSchedule('@daily')).toBe('@daily');
  });
});

describe('jobMatches', () => {
  it('searches name, command, schedule and user, ignoring case', () => {
    for (const query of ['', 'BACK', '/opt', '0 2', 'roo']) expect(jobMatches(job, query)).toBe(true);
    expect(jobMatches(job, 'nginx')).toBe(false);
  });
});

describe('initiallyExpanded', () => {
  it('opens nodes with jobs, or every node when none has any', () => {
    expect([...initiallyExpanded([{ nodeId: 'a', jobs: [job] }, { nodeId: 'b', jobs: [] }])]).toEqual(['a']);
    expect([...initiallyExpanded([{ nodeId: 'a', jobs: [] }, { nodeId: 'b', jobs: [] }])]).toEqual(['a', 'b']);
  });
});

describe('publishBody', () => {
  it('builds the library file the old console created', () => {
    const body = publishBody(job, '1.0.0', 'nightly');
    expect(body).toMatchObject({ name: 'backup v1.0.0', fileName: 'backup-1.0.0.json', mimeType: 'application/x-magnus-cronjob', tags: ['cronjob', 'cron'] });
    expect(JSON.parse(body.content)).toEqual({ name: 'backup', version: '1.0.0', schedule: '0 2 * * *', command: '/opt/backup.sh', description: 'nightly' });
  });
});
