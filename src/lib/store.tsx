import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { adminApi, ApiError } from './api';
import { browserIdentity, productInstalled } from './runtime';
import { allowedStoreResource } from './router-access';
import { optionalRouterPrincipal } from './router-principal';
import { verifySession } from './session-events';
import type {
  ApiDoc,
  AuditEvent,
  ClientKey,
  HeuristicRule,
  HiveActor,
  HiveIncident,
  HiveStatus,
  ModelAlias,
  Provider,
  RouteRule,
  RuntimeSetting,
  Telemetry,
  Trace,
} from './types';

export interface RouterData {
  providers: Provider[];
  aliases: ModelAlias[];
  routeRules: RouteRule[];
  heuristics: HeuristicRule[];
  clientKeys: ClientKey[];
  telemetry: Telemetry | null;
  traces: Trace[];
  audit: AuditEvent[];
  actors: HiveActor[];
  incidents: HiveIncident[];
  runtimeSettings: RuntimeSetting[];
  docs: ApiDoc[];
  hiveStatus: HiveStatus | null;
}

const EMPTY: RouterData = {
  providers: [],
  aliases: [],
  routeRules: [],
  heuristics: [],
  clientKeys: [],
  telemetry: null,
  traces: [],
  audit: [],
  actors: [],
  incidents: [],
  runtimeSettings: [],
  docs: [],
  hiveStatus: null,
};

export interface ResourceFreshness {
  lastSuccess: string | null;
  error: string | null;
}
interface StoreApi {
  resourceFreshness: Partial<Record<keyof RouterData, ResourceFreshness>>;
  data: RouterData;
  /** No load has finished yet. The first one starts when a page reads the store. */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Sections that failed to refresh, as "section: reason". */
  loadIssues: string[];
  /**
   * The incident aggregator's notes, such as one source's failure summary being unavailable. The
   * incidents themselves loaded, so these are not refresh failures.
   */
  incidentNotes: string[];
  lastSync: Date | null;
  refresh: () => Promise<void>;
  onAuthExpired: () => void;
  /** A page that shows store data asks for it here; the store loads and auto-refreshes only while asked. */
  demand: () => () => void;
}

const StoreContext = createContext<StoreApi | null>(null);

/** The store's state without asking it to load: the shell's status and counts. */
export function useStoreStatus(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

/** Keeps the store loaded and refreshing while `active`, for a page the shell has not mounted yet. */
export function useStoreDemand(active: boolean): void {
  const { demand } = useStoreStatus();
  useEffect(() => (active ? demand() : undefined), [active, demand]);
}

/** The store's data, for a page that shows it: mounting the page starts the first load. */
export function useStore(): StoreApi {
  const ctx = useStoreStatus();
  useStoreDemand(true);
  return ctx;
}

/** How often the store refreshes while a page that reads it is on screen and the tab is visible. */
export const AUTO_REFRESH_MS = 60_000;

export function StoreProvider({
  onAuthExpired,
  children,
}: {
  onAuthExpired: () => void;
  children: ReactNode;
}) {
  const [data, setData] = useState<RouterData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadIssues, setLoadIssues] = useState<string[]>([]);
  const [incidentNotes, setIncidentNotes] = useState<string[]>([]);
  const [demanders, setDemanders] = useState(0);
  const inFlight = useRef(false);
  // When the last refresh started, finished or failed: the timer waits a full period after either.
  const lastAttemptAt = useRef(0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [resourceFreshness, setResourceFreshness] = useState<
    Partial<Record<keyof RouterData, ResourceFreshness>>
  >({});
  const firstLoad = useRef(true);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const refreshId = ++generation.current;
    inFlight.current = true;
    lastAttemptAt.current = Date.now();
    if (firstLoad.current) setLoading(true);
    else setRefreshing(true);
    setError(null);
    setLoadIssues([]);
    try {
      const browser = !!browserIdentity();
      const user =
        browser && productInstalled('emberpath')
          ? await optionalRouterPrincipal(
              () => adminApi.resourceMe('emberpath'),
              () => browserIdentity()!.me(),
            )
          : null;
      const loaders = {
        providers: adminApi.providers,
        aliases: adminApi.aliases,
        routeRules: adminApi.routeRules,
        heuristics: adminApi.heuristics,
        clientKeys: adminApi.clientKeys,
        telemetry: adminApi.telemetry,
        traces: adminApi.traces,
        audit: adminApi.audit,
        actors: adminApi.hiveActors,
        incidents: adminApi.hiveIncidents,
        runtimeSettings: adminApi.runtimeSettings,
        docs: adminApi.docsIndex,
        hiveStatus: adminApi.hiveStatus,
      };
      const keys = (Object.keys(loaders) as Array<keyof typeof loaders>).filter(
        (key) => allowedStoreResource(key, user, browser, productInstalled),
      );
      const requests = Object.fromEntries(
        keys.map((key) => [key, loaders[key]()]),
      ) as Record<keyof typeof loaders, Promise<unknown>>;
      if (browser)
        setData(
          (previous) =>
            Object.fromEntries(
              Object.keys(EMPTY).map((key) => [
                key,
                keys.includes(key as keyof RouterData)
                  ? previous[key as keyof RouterData]
                  : EMPTY[key as keyof RouterData],
              ]),
            ) as unknown as RouterData,
        );
      const settled = await Promise.allSettled(
        keys.map((key) => requests[key]),
      );
      if (refreshId !== generation.current) return;
      const values = new Map<string, unknown>();
      const issues: string[] = [];
      const notes: string[] = [];
      const timestamp = new Date().toISOString();
      setResourceFreshness((previous) => {
        const next = { ...previous };
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index]!;
          const result = settled[index]!;
          if (result.status === 'fulfilled')
            next[key] = { lastSuccess: timestamp, error: null };
          else
            next[key] = {
              lastSuccess: previous[key]?.lastSuccess ?? null,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : 'Request failed',
            };
        }
        return next;
      });
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!;
        const result = settled[index]!;
        if (result.status === 'fulfilled') {
          values.set(key, result.value);
          if (key === 'incidents' && result.value && typeof result.value === 'object' && 'issues' in result.value && Array.isArray(result.value.issues))
            notes.push(...result.value.issues.filter((issue): issue is string => typeof issue === 'string'));
        }
        else {
          if (
            result.reason instanceof ApiError &&
            result.reason.status === 401
          ) {
            // With suite sign-in, Oathweave decides (and a refusal signs out every page).
            if (!browserIdentity()) {
              onAuthExpired();
              return;
            }
            if (!(await verifySession())) return;
          }
          issues.push(
            `${key}: ${result.reason instanceof Error ? result.reason.message : 'Unavailable'}`,
          );
        }
      }
      setLoadIssues(issues);
      setIncidentNotes(notes);
      setError(
        issues.length
          ? `${issues.length} console sections failed to refresh; previous data remains visible`
          : null,
      );
      setData((previous) => ({
        providers:
          (
            values.get('providers') as
              | Awaited<ReturnType<typeof adminApi.providers>>
              | undefined
          )?.data ?? previous.providers,
        aliases:
          (
            values.get('aliases') as
              | Awaited<ReturnType<typeof adminApi.aliases>>
              | undefined
          )?.data ?? previous.aliases,
        routeRules:
          (
            values.get('routeRules') as
              | Awaited<ReturnType<typeof adminApi.routeRules>>
              | undefined
          )?.data ?? previous.routeRules,
        heuristics:
          (
            values.get('heuristics') as
              | Awaited<ReturnType<typeof adminApi.heuristics>>
              | undefined
          )?.data ?? previous.heuristics,
        clientKeys:
          (
            values.get('clientKeys') as
              | Awaited<ReturnType<typeof adminApi.clientKeys>>
              | undefined
          )?.data ?? previous.clientKeys,
        telemetry:
          (values.get('telemetry') as
            | Awaited<ReturnType<typeof adminApi.telemetry>>
            | undefined) ?? previous.telemetry,
        traces:
          (
            values.get('traces') as
              | Awaited<ReturnType<typeof adminApi.traces>>
              | undefined
          )?.data ?? previous.traces,
        audit:
          (
            values.get('audit') as
              | Awaited<ReturnType<typeof adminApi.audit>>
              | undefined
          )?.data ?? previous.audit,
        actors:
          (
            values.get('actors') as
              | Awaited<ReturnType<typeof adminApi.hiveActors>>
              | undefined
          )?.data ?? previous.actors,
        incidents:
          (
            values.get('incidents') as
              | Awaited<ReturnType<typeof adminApi.hiveIncidents>>
              | undefined
          )?.data ?? previous.incidents,
        runtimeSettings:
          (
            values.get('runtimeSettings') as
              | Awaited<ReturnType<typeof adminApi.runtimeSettings>>
              | undefined
          )?.data ?? previous.runtimeSettings,
        docs:
          (
            values.get('docs') as
              | Awaited<ReturnType<typeof adminApi.docsIndex>>
              | undefined
          )?.docs ?? previous.docs,
        hiveStatus:
          (values.get('hiveStatus') as
            | Awaited<ReturnType<typeof adminApi.hiveStatus>>
            | undefined) ?? previous.hiveStatus,
      }));
      setLastSync(new Date());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        if (!browserIdentity()) {
          onAuthExpired();
          return;
        }
        if (!(await verifySession())) return;
      }
      setError(
        caught instanceof Error ? caught.message : 'Failed to load admin data',
      );
    } finally {
      if (refreshId !== generation.current) return;
      inFlight.current = false;
      lastAttemptAt.current = Date.now();
      firstLoad.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [onAuthExpired]);

  const demand = useCallback(() => {
    setDemanders((count) => count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setDemanders((count) => count - 1);
    };
  }, []);
  const active = demanders > 0;
  // Nothing loads until a page that shows the data is on screen, so other pages never wait on
  // Emberpath. While one is, the data refreshes on a timer, paused while the tab is hidden, and at
  // once when the tab comes back after a longer absence.
  useEffect(() => {
    if (!active) return;
    if (firstLoad.current && !inFlight.current) void refresh();
    const due = () => document.visibilityState === 'visible' && !inFlight.current && Date.now() - lastAttemptAt.current >= AUTO_REFRESH_MS;
    const timer = setInterval(() => {
      if (due()) void refresh();
    }, AUTO_REFRESH_MS / 4);
    const visible = () => {
      if (due()) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, refresh]);

  return (
    <StoreContext.Provider
      value={{
        data,
        loading,
        refreshing,
        error,
        loadIssues,
        incidentNotes,
        lastSync,
        refresh,
        onAuthExpired,
        resourceFreshness,
        demand,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
