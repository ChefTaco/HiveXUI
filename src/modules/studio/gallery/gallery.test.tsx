// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { resetProjectStores } from '../state/project-store';
import { PROJECT_ID, revision, serveStudio, snapshot, team, TEMPLATE_ID, templateDetail, templateSummary, type StudioRequest } from '../test-fixtures';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

let route: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;

beforeEach(() => {
  stubBrowser();
  route = () => undefined;
  server = serveStudio((request) => route(request));
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

async function open(path: string) {
  history.replaceState({ studioOrigin: '/' }, '', path);
  view = await mount(<StudioModule />);
  await settle(20);
  await settle(20);
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const v2 = () => {
  const detail = templateDetail();
  return { ...detail, latest_version: 2, versions: [{ version: 2, changelog: 'Adds a cartographer', created_by: 'operator', created_at: detail.created_at }, ...detail.versions], latest: { ...detail.latest, version: 2, changelog: 'Adds a cartographer' } };
};

describe('the Gallery', () => {
  it('lists team templates, filters through the service, and switches to agent templates', async () => {
    route = (request) => (request.path.startsWith('/templates?') ? { templates: [templateSummary(), templateSummary({ id: 'tpl_01HZX3K6Q1V8R2M4N6P8T0W002', name: 'Research Team', source: 'user', category: 'research' })] } : undefined);
    const root = await open('/studio/gallery');
    expect([...root.querySelectorAll('.studio-card h3')].map((item) => item.textContent)).toEqual(['Adventure Studio', 'Research Team']);
    expect(server.requests[0]!.path).toBe('/templates?kind=team&archived=false');
    await act(async () => {
      const select = root.querySelector<HTMLSelectElement>('select[aria-label="Source"]')!;
      select.value = 'user';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(server.requests.at(-1)!.path).toBe('/templates?kind=team&archived=false&source=user');
    await click(button('Agents', root));
    await settle();
    expect(server.requests.at(-1)!.path).toBe('/templates?kind=agent&archived=false&source=user');
  });

  it('shows a template’s detail with its versions and what using it does', async () => {
    route = (request) => (request.path === `/templates/${TEMPLATE_ID}` ? v2() : request.path === `/templates/${TEMPLATE_ID}/versions/1` ? templateDetail().latest : undefined);
    const root = await open(`/studio/gallery?template=${TEMPLATE_ID}`);
    expect(text(root)).toContain('Adventure Studio');
    expect(text(root)).toContain('Using it starts a new project with 3 roles');
    expect(text(root)).toContain('Adds a cartographer');
    expect(root.querySelector('[aria-current="page"]')?.textContent).toContain('v2');
    await click([...root.querySelectorAll('a')].find((link) => link.textContent?.startsWith('v1')));
    await settle();
    expect(location.search).toBe(`?template=${TEMPLATE_ID}%401`);
    expect(text(root)).toContain('v1 of 2');
  });

  it('uses a template in the project, asking before it replaces a draft', async () => {
    const applied: unknown[] = [];
    route = (request) => {
      if (request.path === `/templates/${TEMPLATE_ID}`) return templateDetail();
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ team: team({ draft: revision({ revision: 2, status: 'draft' }) }) });
      if (request.path === `/projects/${PROJECT_ID}/team/apply-template`) {
        applied.push(request.body);
        return (request.body as { replace_draft: boolean }).replace_draft ? team() : Response.json({ error: { code: 'DRAFT_EXISTS', message: 'A draft exists' } }, { status: 409 });
      }
      return undefined;
    };
    const root = await open(`/studio/p/${PROJECT_ID}/team/gallery?template=${TEMPLATE_ID}`);
    await click(button('Use in project', root));
    await settle();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Replace the team draft?');
    await click(button('Replace draft', document.querySelector('[role="alertdialog"]')!));
    await settle();
    expect(applied).toEqual([{ template_id: TEMPLATE_ID, version: 1, replace_draft: false }, { template_id: TEMPLATE_ID, version: 1, replace_draft: true }]);
    expect(location.pathname).toBe(`/studio/p/${PROJECT_ID}/team`);
  });

  it('saves a customized template as its next version, and archives after confirmation', async () => {
    let detail = templateDetail();
    route = (request) => {
      if (request.path === `/templates/${TEMPLATE_ID}`) return detail;
      if (request.path === `/templates/${TEMPLATE_ID}/versions`) return v2();
      if (request.path === `/templates/${TEMPLATE_ID}/archive`) {
        detail = { ...detail, archived: true };
        return detail;
      }
      return undefined;
    };
    const root = await open(`/studio/gallery?template=${TEMPLATE_ID}`);
    await click(button('Customize', root));
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(button('Save new version', drawer)?.disabled).toBe(true);
    const field = (label: string) => [...drawer.querySelectorAll('label.field')].find((item) => item.querySelector('.field-label')?.textContent === label)!.querySelector('input, textarea');
    await type(field('Purpose'), 'Write and map an adventure.');
    await type(field('Changelog'), 'Sharper purpose');
    await click(button('Save new version', drawer));
    await settle();
    const saved = server.mutations().find((request) => request.path.endsWith('/versions'));
    expect(saved?.body).toMatchObject({ base_version: 1, changelog: 'Sharper purpose', body: { purpose: 'Write and map an adventure.', name: 'Adventure Studio' } });

    detail = templateDetail();
    await click(button('Archive', root));
    await click(button('Archive', document.querySelector('[role="alertdialog"]')!));
    await settle();
    expect(server.mutations().at(-1)).toMatchObject({ path: `/templates/${TEMPLATE_ID}/archive`, body: { archived: true } });
    expect(button('Unarchive', root)).toBeDefined();
  });
});

describe('a template update in Team Assignment', () => {
  it('offers the newer version and applies chosen changes to the draft, pinning the new version', async () => {
    const newer = v2();
    if (newer.latest.kind !== 'team') throw new Error('team template expected');
    const body = structuredClone(newer.latest.body);
    body.roles[1] = { ...body.roles[1]!, instructions_md: 'Cite every source.' };
    newer.latest = { ...newer.latest, body };
    const puts: unknown[] = [];
    route = (request) => {
      if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot({ team: team({ current: revision({ source_template: { template_id: TEMPLATE_ID, version: 1 } }) }) });
      if (request.path === '/agents') return { agents: [], available_count: 0, magnus: { state: 'ok', error: null } };
      if (request.path === `/templates/${TEMPLATE_ID}`) return newer;
      if (request.path === `/templates/${TEMPLATE_ID}/versions/1`) return templateDetail().latest;
      if (request.path === `/templates/${TEMPLATE_ID}/versions/2`) return newer.latest;
      if (request.path === `/projects/${PROJECT_ID}/team/validate`) return { issues: [], can_publish: true, can_start_room: false, agent_facts: 'complete' };
      if (request.path === `/projects/${PROJECT_ID}/team/draft`) {
        puts.push(request.body);
        return team();
      }
      return undefined;
    };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const root = await open(`/studio/p/${PROJECT_ID}/team?view=table`);
    expect(text(root)).toContain('Adventure Studio has version 2; this team uses version 1.');
    await click(button('Review changes', root));
    await settle(20);
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(text(drawer)).toContain('Worldbuilder: instructions');
    await click(button(/Apply 1 to draft/, drawer));
    await settle(1000);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ source_template: { template_id: TEMPLATE_ID, version: 2 }, body: { roles: expect.arrayContaining([expect.objectContaining({ key: 'world', instructions_md: 'Cite every source.', agent_ref: 'node-1~world' })]) } });
  });
});
