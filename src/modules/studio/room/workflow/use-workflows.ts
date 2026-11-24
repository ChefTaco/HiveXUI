// The project's workflow runs, read once and kept current from the project stream: a run event
// carries the whole run, a node event the node and the run's new state. After a stream reset the list
// is read again. A Studio without workflow runs answers 404, which hides the panel.
import { useCallback, useEffect, useRef, useState } from 'react';
import { workflowNodeSchema, workflowRunSchema } from '@contracts/ardentstudio.generated';
import { listWorkflowRuns, type WorkflowRun } from '../../api/execution';
import type { ProjectEvent } from '../../api/stream';
import type { ProjectStore } from '../../state/project-store';

export type WorkflowsState = { status: 'loading' } | { status: 'unsupported' } | { status: 'error'; error: unknown } | { status: 'ready'; runs: WorkflowRun[] };

const newest = (a: WorkflowRun, b: WorkflowRun) => (b.created_at > a.created_at ? 1 : b.created_at < a.created_at ? -1 : 0);

/** The runs after one event, or null when the event says nothing this list can apply. */
export function applyWorkflowEvent(runs: readonly WorkflowRun[], event: ProjectEvent): WorkflowRun[] | null {
  if (event.type === 'workflow.run.created' || event.type === 'workflow.run.updated') {
    const run = workflowRunSchema.safeParse(event.payload.run);
    if (!run.success) return null;
    const known = runs.find((item) => item.id === run.data.id);
    // An older copy never replaces a newer one.
    if (known && known.updated_at > run.data.updated_at) return [...runs];
    return [...runs.filter((item) => item.id !== run.data.id), run.data].sort(newest);
  }
  if (event.type === 'workflow.node.updated') {
    const node = workflowNodeSchema.safeParse(event.payload.node);
    const runId = event.payload.run_id;
    const run = runs.find((item) => item.id === runId);
    if (!node.success || !run) return null;
    const state = workflowRunSchema.shape.state.safeParse(event.payload.run_state);
    const nodes = run.nodes.map((item) => (item.key === node.data.key ? node.data : item));
    return runs.map((item) => (item.id === run.id ? { ...run, nodes, ...(state.success ? { state: state.data } : {}) } : item));
  }
  return null;
}

export function useWorkflowRuns(store: ProjectStore, list = listWorkflowRuns): { state: WorkflowsState; reload: () => void; replace: (run: WorkflowRun) => void } {
  const [state, setState] = useState<WorkflowsState>({ status: 'loading' });
  const current = useRef(state);
  current.current = state;
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    list(store.projectId, controller.signal).then(
      (runs) => {
        if (!controller.signal.aborted) setState(runs ? { status: 'ready', runs: [...runs].sort(newest) } : { status: 'unsupported' });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      },
    );
    return () => controller.abort();
  }, [store, generation, list]);
  useEffect(() => {
    const offEvent = store.onEvent((event) => {
      const known = current.current;
      if (!event.type.startsWith('workflow.') || known.status !== 'ready') return;
      const next = applyWorkflowEvent(known.runs, event);
      if (next) {
        current.current = { status: 'ready', runs: next };
        setState(current.current);
      }
      // A run this copy does not hold yet, or a shape it cannot read: read the list again.
      else reload();
    });
    const offReset = store.onReset(reload);
    return () => {
      offEvent();
      offReset();
    };
  }, [store, reload]);
  const replace = useCallback((run: WorkflowRun) => setState((known) => (known.status === 'ready' ? { status: 'ready', runs: [...known.runs.filter((item) => item.id !== run.id), run].sort(newest) } : known)), []);
  return { state, reload, replace };
}
