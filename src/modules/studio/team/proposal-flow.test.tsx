// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { acquireProjectStore, resetProjectStores } from '../state/project-store';
import { agent, AT, PROJECT_ID, proposal, revision, serveStudio, snapshot, team, teamBody, type StudioRequest } from '../test-fixtures';
import type { TeamProposalRecord, TeamState } from '../api/endpoints';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

const BASE = `/projects/${PROJECT_ID}`;
const AGENTS = { agents: [agent(), agent({ agent_ref: 'node-1~world', profile: 'world', display_name: 'Worldsmith' }), agent({ agent_ref: 'node-2~editor', node_id: 'node-2', profile: 'editor', display_name: 'Editor' })], available_count: 3, magnus: { state: 'ok', error: null } };

/** The fixture team with the editor renamed and bound, and a cartographer who reports to the lead. */
function readyProposal(overrides: Partial<TeamProposalRecord> = {}): TeamProposalRecord {
  const roles = teamBody().roles.map(({ binding_id: _binding, ...role }) => (role.key === 'editor' ? { ...role, name: 'Continuity Lead', agent_ref: 'node-2~editor' } : role));
  const carto = { ...roles[2]!, key: 'carto', name: 'Cartographer', agent_ref: null, deliverables: ['Regional map'], stage: 'create' as const, responsibilities_md: 'Draws the maps.' };
  const draftBody = { roles: [...roles, carto], relationships: [...teamBody().relationships, { from: 'carto', to: 'lead', type: 'reports_to' as const }], stages: teamBody().stages };
  return proposal({
    state: 'ready',
    progress: 'Proposal ready',
    task_id: null,
    attempts: [{ attempt: 1, task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W009', outcome: 'valid', error: null }],
    proposal: {
      rationale: 'The brief asks for a regional map, and nobody draws maps.',
      source_template: null,
      roles: draftBody.roles.map(({ agent_ref: _agent, knowledge: _knowledge, ...role }) => ({ ...role, rationale: role.key === 'carto' ? 'Draws the regional map.' : '' })),
      relationships: draftBody.relationships,
      stages: draftBody.stages,
      bindings: [
        { role_key: 'lead', agent_ref: 'node-1~lead', reason: '' },
        { role_key: 'world', agent_ref: 'node-1~world', reason: '' },
        { role_key: 'editor', agent_ref: 'node-2~editor', reason: 'Edits for continuity already.' },
      ],
    },
    draft_body: draftBody,
    finished_at: AT,
    ...overrides,
  });
}

let state: TeamState;
let proposals: TeamProposalRecord[];
let answer: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;

function route(request: StudioRequest): unknown {
  const custom = answer(request);
  if (custom !== undefined) return custom;
  if (request.path === `${BASE}/snapshot`) return snapshot({ team: state });
  if (request.path === '/agents') return AGENTS;
  if (request.path === `${BASE}/team/proposals`) return { proposals };
  if (request.path === `${BASE}/team/validate`) return { issues: [], can_publish: true, can_start_room: true, agent_facts: 'complete' };
  if (request.path === `${BASE}/team/draft`) {
    const body = (request.body as { body: { roles: Array<Record<string, unknown>> } }).body;
    state = { ...state, draft: revision({ revision: 2, status: 'draft', updated_at: '2026-11-08T12:00:00.000Z', body: { ...body, roles: body.roles.map((role) => ({ ...role, binding_id: null })) } as never }) };
    return state;
  }
  return undefined;
}

beforeEach(() => {
  stubBrowser();
  state = team();
  proposals = [];
  answer = () => undefined;
  server = serveStudio(route);
  vi.stubGlobal('fetch', server.fetch);
  localStorage.clear();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

async function open(search = '?view=table') {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  history.replaceState({ studioOrigin: '/' }, '', `/studio/p/${PROJECT_ID}/team${search}`);
  view = await mount(<StudioModule />);
  await settle(50);
  await settle(50);
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const puts = () => server.requests.filter((request) => request.method === 'PUT');
let seq = 5;
async function emit(record: TeamProposalRecord) {
  const { store, release } = acquireProjectStore(PROJECT_ID);
  seq += 1;
  await act(async () => {
    store.receive({ event: 'team.proposal.updated', data: JSON.stringify({ seq, project_id: PROJECT_ID, type: 'team.proposal.updated', at: AT, payload: { proposal: record } }) });
  });
  release();
}
const progress = () => document.querySelector('[aria-label="Team proposal"]');

describe('proposing a team', () => {
  beforeEach(() => {
    seq = 5;
  });

  it('asks the coordinator by default and shows queued, the retry with its validation error, and the failure', async () => {
    answer = (request) => (request.method === 'POST' && request.path === `${BASE}/team/propose` ? Response.json(proposal(), { status: 201 }) : undefined);
    const root = await open();
    await click(button('Propose team', root));
    const drawer = document.querySelector('aside[aria-label="Propose a team from the brief"]')!;
    expect((drawer.querySelector('select') as HTMLSelectElement).value).toBe('node-1~lead');
    expect(text(drawer)).toContain('Lead (coordinator: Story Lead)');
    await click(button('Ask for a proposal', drawer));
    await settle();
    expect(server.mutations().find((request) => request.path === `${BASE}/team/propose`)?.body).toEqual({ agent_ref: 'node-1~lead' });
    expect(document.querySelector('aside[aria-label="Propose a team from the brief"]')).toBeNull();
    expect(text(progress()!)).toContain('Team proposal from Lead');
    expect(text(progress()!)).toContain('Queued');
    expect(button('Cancel', progress()!)).toBeDefined();

    const retry = proposal({
      state: 'running',
      updated_at: '2026-11-08T10:01:00.000Z',
      attempts: [
        { attempt: 1, task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W009', outcome: 'invalid', error: 'roles: Exactly one role must be the coordinator (found 2)' },
        { attempt: 2, task_id: 'tsk_01HZX3K6Q1V8R2M4N6P8T0W010', outcome: 'pending', error: null },
      ],
    });
    await emit(retry);
    expect(text(progress()!)).toContain('Attempt 2 of 2: retrying');
    expect(text(progress()!)).toContain('The first reply did not validate: roles: Exactly one role must be the coordinator (found 2)');

    await emit({ ...retry, state: 'failed', updated_at: '2026-11-08T10:02:00.000Z', task_id: null, error: 'The agent did not return a valid team proposal.', attempts: [retry.attempts[0]!, { ...retry.attempts[1]!, outcome: 'invalid', error: 'relationships[2].to: Unknown role "maps"' }] });
    expect(text(progress()!)).toContain('Failed after a retry');
    expect(text(progress()!)).toContain('Unknown role "maps"');
    expect(button('Cancel', progress()!)).toBeUndefined();
    await click(button('Ask again', progress()!));
    expect(document.querySelector('aside[aria-label="Propose a team from the brief"]')).not.toBeNull();
    await click(button('Cancel', document.querySelector('aside')!));
    await click(button('Dismiss', progress()!));
    expect(progress()).toBeNull();
    expect(puts()).toHaveLength(0);
  });

  it('cancels a queued proposal through its task, and explains a refused request', async () => {
    proposals = [proposal()];
    answer = (request) => {
      if (request.path === `/tasks/${proposal().task_id}/cancel`) return { id: proposal().task_id };
      if (request.path === `${BASE}/team/propose`) return Response.json({ error: { code: 'PROPOSAL_IN_PROGRESS', message: 'A proposal is in progress' } }, { status: 409 });
      return undefined;
    };
    const root = await open();
    expect(text(progress()!)).toContain('Queued');
    await click(button('Propose team', root));
    const drawer = document.querySelector('aside[aria-label="Propose a team from the brief"]')!;
    expect(text(drawer)).toContain('A proposal is already being prepared');
    expect(button('Ask for a proposal', drawer)?.disabled).toBe(true);
    await click(button('Cancel', drawer));
    await click(button('Cancel', progress()!));
    await settle();
    expect(server.mutations().map((request) => request.path)).toContain(`/tasks/${proposal().task_id}/cancel`);
  });
});

describe('reviewing a ready proposal', () => {
  it('shows the ghost diff in the Table view and applies nothing on Discard', async () => {
    proposals = [readyProposal()];
    const root = await open();
    const review = root.querySelector('.studio-proposal')!;
    expect(text(review)).toContain('Proposed team from Lead');
    expect(text(review)).toContain('The brief asks for a regional map');
    expect(text(review)).toContain('1 added · 1 changed');
    expect(text(review)).toContain('Draws the regional map.');
    expect(text(review)).toContain('Agent: Edits for continuity already.');
    expect(review.querySelector('[aria-label="Proposal changes"]')).not.toBeNull();
    const rows = [...root.querySelectorAll('.studio-ghost-row')].filter((row) => row.closest('[aria-label="Proposed roles"], table')?.querySelector('caption')?.textContent?.startsWith('Roles'));
    const byName = new Map(rows.map((row) => [row.children[1]!.textContent!.replace(' · coordinator', ''), row.children[0]!.textContent]));
    expect(byName.get('Cartographer')).toBe('Added');
    expect(byName.get('Continuity Lead')).toBe('Changed');
    expect(byName.get('Story Lead')).toBe('Unchanged');
    expect(root.querySelector('tr.studio-ghost--added')).not.toBeNull();
    // The editable table is not shown while the preview is.
    expect(root.querySelector('[aria-label="Name of Worldbuilder"]')).toBeNull();

    await click(button('Discard', review));
    await settle(1000);
    expect(root.querySelector('.studio-proposal')).toBeNull();
    expect(root.querySelector('[aria-label="Name of Worldbuilder"]')).not.toBeNull();
    expect(puts()).toHaveLength(0);
    expect(localStorage.getItem(`studio-proposals-dismissed:${PROJECT_ID}`)).toContain(readyProposal().id);
  });

  it('Accept all sends the proposal’s draft body against the published revision', async () => {
    proposals = [readyProposal()];
    const root = await open();
    await click(button('Accept all', root));
    await settle();
    expect(puts()).toHaveLength(1);
    expect(puts()[0]!.body).toEqual({ base_revision: 1, body: readyProposal().draft_body });
    expect(root.querySelector('.studio-proposal')).toBeNull();
    expect(text(document.body)).toContain('Applied the proposed team to the draft');
  });

  it('accepts per role: only the checked roles and their lines join the draft', async () => {
    proposals = [readyProposal()];
    const root = await open();
    const editor = root.querySelector<HTMLInputElement>('#proposal-role-editor')!;
    expect(editor.checked).toBe(true);
    await click(editor);
    expect(button('Accept 1 role', root)).toBeDefined();
    await click(button('Accept 1 role', root));
    await settle();
    const body = (puts()[0]!.body as { body: { roles: Array<{ key: string; name: string; agent_ref: string | null }>; relationships: Array<{ from: string; to: string }> } }).body;
    expect(body.roles.map((role) => role.key)).toEqual(['lead', 'world', 'editor', 'carto']);
    expect(body.roles.find((role) => role.key === 'editor')).toMatchObject({ name: 'Continuity Editor', agent_ref: null });
    expect(body.relationships).toContainEqual({ from: 'carto', to: 'lead', type: 'reports_to' });
  });

  it('warns before applying when the team changed since the proposal, and applies only on confirmation', async () => {
    proposals = [readyProposal({ basis: { current_revision: null, draft_revision: null, source_template: null } })];
    const root = await open();
    await click(button('Accept all', root));
    expect(dialog()?.textContent).toContain('The team changed since this proposal');
    expect(dialog()?.textContent).toContain('published as r1');
    expect(puts()).toHaveLength(0);
    await click(button('Cancel', dialog()!));
    expect(puts()).toHaveLength(0);
    await click(button('Accept all', root));
    await click(button('Replace the draft', dialog()!));
    await settle();
    expect(puts()).toHaveLength(1);
  });

  it('draws the difference on the canvas, and Enter on a ghost role reaches its accept box', async () => {
    proposals = [readyProposal()];
    const root = await open('?view=team');
    await settle(100);
    const carto = root.querySelector<HTMLElement>('[data-role-key="carto"]')!;
    expect(carto.getAttribute('aria-label')).toContain('Cartographer, added by the proposal');
    expect(carto.querySelector('.studio-role-card')?.className).toContain('border-success');
    expect(text(carto)).toContain('Added');
    expect(root.querySelector('[data-role-key="editor"]')!.getAttribute('aria-label')).toContain('changed by the proposal');
    expect(root.querySelector('[data-role-key="lead"]')!.getAttribute('aria-label')).not.toContain('proposal');
    carto.focus();
    await act(async () => {
      carto.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(document.activeElement?.id).toBe('proposal-role-carto');

    await click(button('Hide preview', root));
    expect(root.querySelector('[data-role-key="carto"]')).toBeNull();
    expect(text(progress()!)).toContain('Ready to review');
    await click(button('Review', progress()!));
    expect(root.querySelector('.studio-proposal')).not.toBeNull();
  });
});

describe('proposing from the create flow', () => {
  it('asks the chosen agent once the starting team is set, stays on a refusal, then opens Team Assignment', async () => {
    const order: string[] = [];
    answer = (request) => {
      if (request.method !== 'GET') order.push(request.path);
      if (request.path === BASE) return { ...snapshot().project };
      if (request.path === '/templates?kind=team') return { templates: [] };
      if (request.path === `${BASE}/team/propose`) {
        return order.length === 1 ? Response.json({ error: { code: 'MAGNUS_UNAVAILABLE', message: 'Magnus did not answer' } }, { status: 503 }) : Response.json(proposal({ agent_ref: 'node-1~world' }), { status: 201 });
      }
      return undefined;
    };
    history.replaceState({ studioOrigin: '/' }, '', `/studio/new?project=${PROJECT_ID}&step=3`);
    view = await mount(<StudioModule />);
    await settle();
    await settle();
    const root = view.container;
    await click(root.querySelector<HTMLInputElement>('.studio-start-options label:nth-child(3) input'));
    const toggle = [...root.querySelectorAll<HTMLInputElement>('.toggle input')].find((input) => input.closest('label')?.textContent?.includes('propose a team'))!;
    await click(toggle);
    await settle();
    const select = [...root.querySelectorAll<HTMLSelectElement>('select')].at(-1)!;
    // The fixture team's coordinator is bound to an available agent, so it is asked by default.
    expect(select.value).toBe('node-1~lead');
    await act(async () => {
      select.value = 'node-1~world';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button('Ask and open Team Assignment', root));
    await settle();
    expect(text(root)).toContain('Magnus is unavailable');
    expect(location.pathname).toBe('/studio/new');
    await click(button('Ask and open Team Assignment', root));
    await settle();
    expect(order).toEqual([`${BASE}/team/propose`, `${BASE}/team/propose`]);
    expect(server.mutations().at(-1)!.body).toEqual({ agent_ref: 'node-1~world' });
    expect(location.pathname + location.search).toBe(`/studio/p/${PROJECT_ID}/team?start=1`);
  });
});
