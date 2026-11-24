import { describe, expect, it } from 'vitest';
import { recovery, task } from '../test-fixtures';
import { controlFeedback, groupTasks, taskChip, taskControls } from './tasks';

const id = (n: number) => `tsk_01HZX3K6Q1V8R2M4N6P8T0W${String(n).padStart(3, '0')}`;

describe('task groups', () => {
  it('sorts tasks into the drawer groups', () => {
    const groups = groupTasks([
      task({ id: id(1), state: 'running' }),
      task({ id: id(2), state: 'input_required' }),
      task({ id: id(3), state: 'running', mode: 'review' }),
      task({ id: id(4), state: 'failed' }),
      task({ id: id(5), state: 'completed' }),
      task({ id: id(6), state: 'completed', outcome: { team_result: { outcome: 'blocked', artifacts: 0 } } }),
    ]);
    expect(Object.fromEntries(Object.entries(groups).map(([group, list]) => [group, list.map((item) => item.id)]))).toEqual({
      assignments: [id(1)],
      blockers: [id(4), id(6)],
      questions: [id(2)],
      reviews: [id(3)],
      outcomes: [id(5)],
    });
  });

  it('drops a blocker once its work was reassigned', () => {
    const groups = groupTasks([task({ id: id(1), state: 'failed' }), task({ id: id(2), state: 'queued', reassigned_from: id(1) })]);
    expect(groups.blockers).toEqual([]);
    expect(groups.assignments.map((item) => item.id)).toEqual([id(2)]);
  });

  it('offers only the controls a state allows', () => {
    expect(taskControls(task({ state: 'running' }))).toEqual({ pause: true, resume: false, cancel: true, reassign: true });
    expect(taskControls(task({ state: 'pausing' }))).toEqual({ pause: false, resume: true, cancel: true, reassign: true });
    expect(taskControls(task({ state: 'completed' }))).toEqual({ pause: false, resume: false, cancel: false, reassign: false });
  });
});

describe('task control feedback', () => {
  it('says a pause was requested until the task is paused', () => {
    expect(controlFeedback('pause', 'running')).toBe('Pause requested…');
    expect(controlFeedback('pause', 'pausing')).toBe('Pause requested…');
    expect(controlFeedback('pause', 'paused')).toBe('Paused');
  });
  it('confirms resume and cancel only from the task state', () => {
    expect(controlFeedback('resume', 'paused')).toBe('Resume requested…');
    expect(controlFeedback('resume', 'running')).toBe('Resumed');
    expect(controlFeedback('cancel', 'running')).toBe('Cancel requested…');
    expect(controlFeedback('cancel', 'cancelled')).toBe('Cancelled');
  });
  it('still explains a pause someone else asked for', () => {
    expect(controlFeedback(null, 'pausing')).toBe('Pause requested…');
    expect(controlFeedback(null, 'running')).toBeNull();
  });
});

describe('task state chips', () => {
  it('tells recovering, a decision about an unknown effect and an unknown outcome apart', () => {
    for (const status of ['ready', 'reconciling', 'resumed'] as const) expect(taskChip(task({ state: 'running', recovery: recovery({ status, actions: [] }) }))).toMatchObject({ label: 'Recovering', recovery: 'recovering' });
    expect(taskChip(task({ state: 'unknown', recovery: recovery() }))).toEqual({ label: 'Needs decision (effect unknown)', tone: 'warning', recovery: 'needs_decision' });
    expect(taskChip(task({ state: 'unknown', recovery: recovery({ status: 'unsupported', actions: [] }) }))).toEqual({ label: 'Unknown outcome', tone: 'danger', recovery: 'unknown_outcome' });
  });
  it('keeps paused, cancelled, failed and an unknown task without recovery as they were, each distinct', () => {
    const labels = (['paused', 'cancelled', 'failed', 'running', 'unknown'] as const).map((state) => taskChip(task({ state, recovery: null })).label);
    expect(labels).toEqual(['Paused', 'Cancelled', 'Failed', 'Running', 'Unknown']);
    expect(new Set(labels).size).toBe(labels.length);
    expect(taskChip(task({ state: 'failed' })).tone).toBe('danger');
    // A resolved recovery says nothing more than the state.
    expect(taskChip(task({ state: 'running', recovery: recovery({ status: 'resolved', actions: [] }) })).label).toBe('Running');
  });
  it('puts a task that needs a decision among the blockers, and a recovering one among the assignments', () => {
    const groups = groupTasks([task({ id: id(1), state: 'unknown', recovery: recovery() }), task({ id: id(2), state: 'running', recovery: recovery({ status: 'ready', actions: [] }) })]);
    expect(groups.blockers.map((item) => item.id)).toEqual([id(1)]);
    expect(groups.assignments.map((item) => item.id)).toEqual([id(2)]);
  });
});
