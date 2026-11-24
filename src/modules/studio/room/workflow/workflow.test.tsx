// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type Mounted } from '../../../magnus/test-dom';
import type { WorkflowNode, WorkflowRun } from '../../api/execution';
import type { ProjectEvent } from '../../api/stream';
import { AT, PROJECT_ID } from '../../test-fixtures';
import { applyWorkflowEvent } from './use-workflows';
import { waitingReason, WorkflowPanel } from './workflow-panel';

const RUN = 'wfr_01HZX3K6Q1V8R2M4N6P8T0W001';
const node = (key: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode => ({
  key, role: 'world', title: key.replace('_', ' '), prompt: 'Research.', needs: [], required: true, join_rule: 'all', attempt: 1, state: 'done',
  task_id: null, attempts: [], result: null, error: null, blocked_by: [], actions: [], updated_at: AT, ...overrides,
});
const run = (nodes: WorkflowNode[], overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: RUN, project_id: PROJECT_ID, name: 'Research and synthesis', state: 'blocked', output: 'synthesis',
  spec: { nodes: nodes.map((item) => ({ key: item.key, role: item.role, prompt: item.prompt, needs: item.needs, required: item.required })), output: 'synthesis' } as WorkflowRun['spec'],
  spec_sha256: 'a'.repeat(64), inputs: {}, source_template: null, root_ref: `hx1:studio:inst:workflow:${RUN}`, created_by: 'operator', created_at: AT, updated_at: AT, finished_at: null, nodes, ...overrides,
});
const blocked = () =>
  run([
    node('research_a', { task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W001' }),
    node('research_b', { state: 'failed', error: 'The agent run failed', actions: ['retry'], task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W002' }),
    node('extras', { state: 'running', required: false, actions: ['skip'] }),
    node('synthesis', { state: 'blocked', needs: ['research_a', 'research_b'], blocked_by: ['research_b'], actions: ['cancel_run'] }),
  ]);
const event = (type: string, payload: Record<string, unknown>): ProjectEvent => ({ seq: 9, project_id: PROJECT_ID, type: type as ProjectEvent['type'], at: AT, payload });

describe('workflow waiting reasons', () => {
  it('names the needs a step waits for, and what blocks it', () => {
    const current = blocked();
    expect(waitingReason(current.nodes[3]!, current)).toBe('Blocked by research b');
    const waiting = run([node('research_a', { state: 'running' }), node('synthesis', { state: 'waiting', needs: ['research_a'] })]);
    expect(waitingReason(waiting.nodes[1]!, waiting)).toBe('Waiting for research a');
    expect(waitingReason(waiting.nodes[0]!, waiting)).toBeNull();
  });
});

describe('workflow events', () => {
  it('applies a node update and the run state it carries, and a whole run', () => {
    const current = [blocked()];
    const retried = applyWorkflowEvent(current, event('workflow.node.updated', { run_id: RUN, run_state: 'running', node: node('research_b', { state: 'running', attempt: 2 }) }))!;
    expect(retried[0]!.state).toBe('running');
    expect(retried[0]!.nodes[1]).toMatchObject({ state: 'running', attempt: 2 });
    const done = applyWorkflowEvent(retried, event('workflow.run.updated', { run: run([node('synthesis')], { state: 'completed', updated_at: '2026-11-08T11:00:00.000Z' }) }))!;
    expect(done[0]!.state).toBe('completed');
    // A node of a run this copy does not hold means: read the list again.
    expect(applyWorkflowEvent(current, event('workflow.node.updated', { run_id: 'wfr_other', run_state: 'running', node: node('x') }))).toBeNull();
  });
});

describe('the workflow panel', () => {
  let view: Mounted | undefined;
  beforeEach(() => stubBrowser());
  afterEach(async () => {
    await view?.unmount();
    view = undefined;
  });

  it('shows each step with its needs and reason, and offers only the actions Studio lists', async () => {
    const act = vi.fn(async () => run([], { state: 'running' }));
    const onChanged = vi.fn();
    const onOpenTask = vi.fn();
    view = await mount(<WorkflowPanel projectId={PROJECT_ID} state={{ status: 'ready', runs: [blocked()] }} roles={[{ key: 'world', name: 'Worldbuilder' } as never]} archived={false} onRetry={() => undefined} onChanged={onChanged} onOpenTask={onOpenTask} act={act} />);
    const root = view.container;
    const synthesis = root.querySelector('[data-node="synthesis"]')!;
    expect(synthesis.textContent).toContain('needs research a, research b');
    expect(synthesis.textContent).toContain('Blocked by research b');
    expect(root.querySelector('[data-node="research_b"]')?.textContent).toContain('The agent run failed');
    expect(button('Retry: research b', root)).toBeDefined();
    expect(button('Retry: research a', root)).toBeUndefined();
    expect(button('Skip: extras', root)).toBeDefined();
    await click(button('Retry: research b', root));
    expect(act).toHaveBeenCalledWith(PROJECT_ID, RUN, 'research_b', 'retry', expect.stringMatching(/^hivexui-/));
    expect(onChanged).toHaveBeenCalled();
    // Skipping and cancelling ask first.
    await click(button('Cancel run: synthesis', root));
    expect(dialog()?.textContent).toContain('Every step still running is cancelled');
    await click(button('Cancel run', dialog()!));
    expect(act).toHaveBeenLastCalledWith(PROJECT_ID, RUN, 'synthesis', 'cancel_run', expect.any(String));
    await click(button('Execution history of research a', root));
    expect(onOpenTask).toHaveBeenCalledWith('tsk_01HZX3K6Q1V8R2M4N6P8T0W001');
  });

  it('keeps the key of a failed action for its retry, and offers no action in an archived project', async () => {
    const act = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(run([]));
    view = await mount(<WorkflowPanel projectId={PROJECT_ID} state={{ status: 'ready', runs: [blocked()] }} roles={[]} archived={false} onRetry={() => undefined} onChanged={() => undefined} act={act} />);
    await click(button('Retry: research b', view.container));
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    await click(button('Retry: research b', view.container));
    expect(act.mock.calls[1]![4]).toBe(act.mock.calls[0]![4]);
    await view.unmount();
    view = await mount(<WorkflowPanel projectId={PROJECT_ID} state={{ status: 'ready', runs: [blocked()] }} roles={[]} archived onRetry={() => undefined} onChanged={() => undefined} act={act} />);
    expect(button('Retry: research b', view.container)).toBeUndefined();
    await settle();
  });

  it('says so on a Studio without workflows', async () => {
    view = await mount(<WorkflowPanel projectId={PROJECT_ID} state={{ status: 'unsupported' }} roles={[]} archived={false} onRetry={() => undefined} onChanged={() => undefined} />);
    expect(view.container.textContent).toContain('Workflows need a newer Studio');
  });
});
