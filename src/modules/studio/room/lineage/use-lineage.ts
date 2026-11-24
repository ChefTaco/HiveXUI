// The open task's lineage, kept current: read when the drawer opens, again when the task or its
// recovery changes, and again when the project stream loses its place (the store's reset, the same
// signal the room's lists reread on). Provider traces come from Emberpath per Ardent attempt.
import { useCallback, useEffect, useState } from 'react';
import { productInstalled } from '../../../../lib/runtime';
import { executionTraces, type Trace } from '../../../agents/api';
import { getTaskLineage, type TaskLineage } from '../../api/execution';
import type { ProjectStore } from '../../state/project-store';
import { ardentTaskRef } from './logic';

export type LineageState =
  | { status: 'loading'; lineage: TaskLineage | null }
  | { status: 'ready'; lineage: TaskLineage }
  /** This Studio serves no lineage: only what the task record says is shown. */
  | { status: 'unsupported'; lineage: null }
  | { status: 'error'; lineage: TaskLineage | null; error: unknown };

/** Events that mean this task's lineage or recovery may have moved. */
const TASK_EVENTS: ReadonlySet<string> = new Set(['task.created', 'task.updated', 'task.recovery']);
const namesTask = (payload: Record<string, unknown>, taskId: string): boolean => {
  const task = payload.task as { id?: unknown } | undefined;
  return task?.id === taskId || payload.task_id === taskId;
};

export function useTaskLineage(store: ProjectStore, taskId: string | null, read = getTaskLineage): { state: LineageState; reload: () => void } {
  const [state, setState] = useState<LineageState>({ status: 'loading', lineage: null });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    setState({ status: 'loading', lineage: null });
  }, [taskId]);
  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    setState((current) => ({ status: 'loading', lineage: current.lineage }));
    read(taskId, controller.signal).then(
      (lineage) => {
        if (!controller.signal.aborted) setState(lineage ? { status: 'ready', lineage } : { status: 'unsupported', lineage: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ status: 'error', lineage: current.lineage, error }));
      },
    );
    return () => controller.abort();
  }, [taskId, generation, read]);
  useEffect(() => {
    if (!taskId) return;
    const offEvent = store.onEvent((event) => {
      if (TASK_EVENTS.has(event.type) && namesTask(event.payload, taskId)) reload();
    });
    const offReset = store.onReset(reload);
    return () => {
      offEvent();
      offReset();
    };
  }, [store, taskId, reload]);
  return { state, reload };
}

export type TraceState = { status: 'idle' | 'loading' | 'unsupported' | 'unavailable' } | { status: 'ready'; byRef: ReadonlyMap<string, Trace[]> };

/**
 * Emberpath's provider traces for every Ardent attempt in the lineage, keyed by the model attempt
 * reference each trace carries. Emberpath before 2.6.0 cannot filter by execution, and a person
 * without Emberpath access gets a refusal: both read as nothing to link.
 */
export function useAttemptTraces(lineage: TaskLineage | null, list = executionTraces, installed = productInstalled): TraceState {
  const [state, setState] = useState<TraceState>({ status: 'idle' });
  useEffect(() => {
    const refs = [...new Set((lineage?.ardent ?? []).map(ardentTaskRef).filter((ref): ref is string => Boolean(ref)))];
    if (!refs.length || !installed('emberpath')) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    Promise.all(refs.map((ref) => list({ executionTask: ref }, controller.signal))).then(
      (answers) => {
        if (controller.signal.aborted) return;
        if (answers.some((answer) => !answer.supported)) {
          setState({ status: 'unsupported' });
          return;
        }
        const byRef = new Map<string, Trace[]>();
        for (const answer of answers)
          if (answer.supported)
            for (const trace of answer.data) {
              const self = trace.execution?.self;
              if (self) byRef.set(self, [...(byRef.get(self) ?? []), trace]);
            }
        setState({ status: 'ready', byRef });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'unavailable' });
      },
    );
    return () => controller.abort();
  }, [lineage, list, installed]);
  return state;
}
