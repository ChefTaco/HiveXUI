// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, settle, stubBrowser, type Mounted } from '../../../magnus/test-dom';
import { taskLineageSchema, type TaskLineage } from '../../api/execution';
import { task } from '../../test-fixtures';
import type { Trace } from '../../../agents/api';
import { ardentTaskRef, buildChain, describeRef, hasExecutionHistory } from './logic';
import { useAttemptTraces, type TraceState } from './use-lineage';

const TASK = 'tsk_01HZX3K6Q1V8R2M4N6P8T0W001';
const ARDENT = '0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e';
const parse = (value: unknown): TaskLineage => taskLineageSchema.parse(value);
const studio = (overrides: Record<string, unknown> = {}) => ({
  self: `hx1:studio:inst:task:${TASK}`, root: 'hx1:studio:inst:request:msg-1', parent: null, execution: null, children: [], reassigned_from: null, reassigned_to: [], handoffs: [],
  assignment_revision: 1, revisions: [], workflow: null, ...overrides,
});

describe('reading Studio lineage', () => {
  it('reads each Ardent attempt, oldest first, and keeps one it could not read with its reason', () => {
    const lineage = parse({
      task_id: TASK,
      studio: studio(),
      ardent: { agent_ref: 'node-1~world', attempts: [
        { ardent_task_id: 'old', ref: null, current: false, lineage: null, error: { code: 'MAGNUS_UNAVAILABLE', message: 'Magnus did not answer' } },
        { ardent_task_id: ARDENT, ref: `hx1:ardent:node-1.world:task:${ARDENT}`, current: true, error: null, lineage: { task_id: ARDENT, children: [], continuations: [], model_attempts: [], tools: [], artifacts: [] } },
      ] },
      ardent_unavailable: null,
      emberpath: { filter: { executionRoot: 'hx1:studio:inst:request:msg-1' } },
    });
    expect(lineage.ardent.map((attempt) => [attempt.ardentTaskId, attempt.current, attempt.error])).toEqual([['old', false, 'Magnus did not answer'], [ARDENT, true, null]]);
    expect(lineage.executionRoot).toBe('hx1:studio:inst:request:msg-1');
    expect(lineage.agentRef).toBe('node-1~world');
  });

  it('builds the chain: root, hand-off from, this task, then what it handed off and started', () => {
    const lineage = parse({
      task_id: TASK,
      studio: studio({
        handoffs: [
          { task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W010', ref: 'hx1:studio:inst:task:tsk_01HZX3K6Q1V8R2M4N6P8T0W010', role_key: 'lead', state: 'completed', mode: 'assignment', direction: 'from', relationship: 'hands_off_to' },
          { task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W011', ref: 'hx1:studio:inst:task:tsk_01HZX3K6Q1V8R2M4N6P8T0W011', role_key: 'editor', state: 'queued', mode: 'assignment', direction: 'to', relationship: 'hands_off_to' },
        ],
        workflow: { run_id: 'wfr_01HZX3K6Q1V8R2M4N6P8T0W001', node_key: 'synthesis', attempt: 2, ref: 'hx1:studio:inst:node:wfr_01HZX3K6Q1V8R2M4N6P8T0W001/synthesis' },
      }),
      ardent: null,
      ardent_unavailable: { code: 'LINEAGE_UNSUPPORTED', message: 'The agent runs Ardent 3.1.4' },
      emberpath: { filter: { executionRoot: null } },
    });
    const known = task({ id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W010', title: 'Outline the stacks' });
    const chain = buildChain(task({ id: TASK }), lineage, new Map([[known.id, known]]));
    expect(chain.map((entry) => [entry.kind, entry.label])).toEqual([
      ['root', 'Studio request msg-1'],
      ['handoff', 'Outline the stacks'],
      ['workflow', 'Workflow step synthesis, attempt 2'],
      ['self', 'Draft the drowned stacks'],
      ['handoff_to', 'Studio task tsk_01HZX3K6Q1V8R2M4N6P8T0W011'],
    ]);
    expect(chain[1]!.taskId).toBe('tsk_01HZX3K6Q1V8R2M4N6P8T0W010');
    expect(chain[4]!.taskId).toBeUndefined();
    expect(lineage.ardentUnavailable).toBe('The agent runs Ardent 3.1.4');
  });

  it('has no history for a task from before ancestry', () => {
    const empty = parse({ task_id: TASK, studio: studio({ self: null, root: null }), ardent: null, ardent_unavailable: null, emberpath: { filter: { executionRoot: null } } });
    expect(hasExecutionHistory(task(), empty)).toBe(false);
    expect(hasExecutionHistory(task(), null)).toBe(false);
    expect(hasExecutionHistory(task({ execution: { root: 'hx1:studio:inst:request:msg-1', parent: null, self: null, attempt: null, inputs: [] } }), null)).toBe(true);
  });

  it('names a reference by product, kind and id, and finds the Ardent task reference of an attempt', () => {
    expect(describeRef('hx1:ardent:node-1.world:task:abc')).toBe('Ardent node-1.world task abc');
    expect(describeRef('not-a-ref')).toBe('not-a-ref');
    const attempt = { ardentTaskId: ARDENT, ref: null, current: true, error: null, lineage: { task_id: ARDENT, children: [], continuations: [], tools: [], artifacts: [], model_attempts: [{ step: 1, attempt: 1, backend: null, request_id: null, ref: `hx1:ardent:node-1.world:attempt:${ARDENT}/1/1`, started_ms: 0 }] } };
    expect(ardentTaskRef(attempt)).toBe(`hx1:ardent:node-1.world:task:${ARDENT}`);
  });
});

describe('provider traces of the attempts', () => {
  let view: Mounted | undefined;
  beforeEach(() => stubBrowser());
  afterEach(async () => {
    await view?.unmount();
    view = undefined;
  });
  const lineage = parse({
    task_id: TASK, studio: studio(), ardent_unavailable: null, emberpath: { filter: { executionRoot: null } },
    ardent: { agent_ref: 'node-1~world', attempts: [{ ardent_task_id: ARDENT, ref: `hx1:ardent:node-1.world:task:${ARDENT}`, current: true, error: null, lineage: { task_id: ARDENT, children: [], continuations: [], tools: [], artifacts: [], model_attempts: [] } }] },
  });
  async function traces(list: NonNullable<Parameters<typeof useAttemptTraces>[1]>): Promise<{ state: TraceState; filters: unknown[] }> {
    const seen: { state: TraceState } = { state: { status: 'idle' } };
    const filters: unknown[] = [];
    const wrapped: typeof list = (filter, signal) => {
      filters.push(filter);
      return list(filter, signal);
    };
    const installed = () => true;
    function Probe() {
      seen.state = useAttemptTraces(lineage, wrapped, installed);
      return null;
    }
    view = await mount(<Probe />);
    await settle();
    return { state: seen.state, filters };
  }
  it('asks Emberpath for every attempt of the Ardent task and keys the traces by attempt reference', async () => {
    const trace = { id: 'tr_1', outcome: 'SUCCEEDED', execution: { self: `hx1:ardent:node-1.world:attempt:${ARDENT}/1/1` } } as unknown as Trace;
    const { state, filters } = await traces(async () => ({ supported: true, data: [trace] }));
    expect(filters).toEqual([{ executionTask: `hx1:ardent:node-1.world:task:${ARDENT}` }]);
    expect(state.status === 'ready' && state.byRef.get(`hx1:ardent:node-1.world:attempt:${ARDENT}/1/1`)).toEqual([trace]);
  });
  it('reads an Emberpath that cannot filter by execution as unsupported, and a refusal as unavailable', async () => {
    expect((await traces(async () => ({ supported: false }))).state.status).toBe('unsupported');
    await view?.unmount();
    view = undefined;
    expect((await traces(async () => Promise.reject(new Error('403')))).state.status).toBe('unavailable');
  });
});
