// Every Studio page, in one data file. Pure data and matching, no React, so tests and the shell can
// read it. Paths are browser addresses under /studio.
import { parseProfileRef } from '../magnus/pages/agents/ardent/logic';
import { STUDIO_PREFIX } from './paths';

export type StudioArea = 'team' | 'room' | 'agents';
export type StudioRouteId =
  | 'home'
  | 'new'
  | 'gallery'
  | 'agent'
  | 'project'
  | 'team'
  | 'team-gallery'
  | 'room'
  | 'project-agent'
  | 'review';

export interface StudioRoute {
  id: StudioRouteId;
  path: string;
  title: string;
  /** The project area tab this page sits under. Project pages without one show the tabs unselected. */
  area?: StudioArea;
}

export const STUDIO_ROUTES: readonly StudioRoute[] = [
  { id: 'home', path: '/studio', title: 'Projects' },
  { id: 'new', path: '/studio/new', title: 'New project' },
  { id: 'gallery', path: '/studio/gallery', title: 'Gallery' },
  { id: 'agent', path: '/studio/agents/:agentRef', title: 'Agent Studio' },
  // Opens the project's last area, which only the Studio service knows.
  { id: 'project', path: '/studio/p/:projectId', title: 'Project' },
  { id: 'team', path: '/studio/p/:projectId/team', title: 'Team Assignment', area: 'team' },
  { id: 'team-gallery', path: '/studio/p/:projectId/team/gallery', title: 'Gallery', area: 'team' },
  { id: 'room', path: '/studio/p/:projectId/room', title: 'Conversation Room', area: 'room' },
  { id: 'project-agent', path: '/studio/p/:projectId/agents/:agentRef', title: 'Agent Studio', area: 'agents' },
  { id: 'review', path: '/studio/p/:projectId/review', title: 'Review', area: 'agents' },
];

export interface StudioMatch {
  route: StudioRoute;
  projectId?: string;
  /** `<nodeId>~<profile>`, the Magnus profile reference. */
  agentRef?: string;
}

const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const isProjectId = (value: string): boolean => PROJECT_ID.test(value);

function match(route: StudioRoute, segments: readonly string[]): Record<string, string> | null {
  const pattern = route.path.split('/').filter(Boolean);
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of pattern.entries()) {
    const segment = segments[index]!;
    if (!part.startsWith(':')) {
      if (part !== segment) return null;
      continue;
    }
    try {
      params[part.slice(1)] = decodeURIComponent(segment);
    } catch {
      return null;
    }
  }
  return params;
}

/** The page for a browser path, or null for an address no Studio page has, including malformed ids. */
export function matchStudioRoute(pathname: string): StudioMatch | null {
  const segments = pathname.split('/').filter(Boolean);
  for (const route of STUDIO_ROUTES) {
    const params = match(route, segments);
    if (!params) continue;
    const { projectId, agentRef } = params;
    if (projectId !== undefined && !isProjectId(projectId)) return null;
    if (agentRef !== undefined && !parseProfileRef(agentRef)) return null;
    return { route, ...(projectId !== undefined ? { projectId } : {}), ...(agentRef !== undefined ? { agentRef } : {}) };
  }
  return null;
}

export const projectHref = (projectId: string, rest = ''): string => `${STUDIO_PREFIX}/p/${encodeURIComponent(projectId)}${rest}`;
export const agentHref = (agentRef: string, projectId?: string): string =>
  projectId ? projectHref(projectId, `/agents/${encodeURIComponent(agentRef)}`) : `${STUDIO_PREFIX}/agents/${encodeURIComponent(agentRef)}`;

/** Where each area tab leads. Agents opens the agent last seen in this project, else the project-wide review. */
export function areaHref(area: StudioArea, projectId: string, lastAgentRef?: string): string {
  if (area === 'team') return projectHref(projectId, '/team');
  if (area === 'room') return projectHref(projectId, '/room');
  return lastAgentRef ? agentHref(lastAgentRef, projectId) : projectHref(projectId, '/review');
}
