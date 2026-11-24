// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArdentDependency } from '@contracts/magnus/browser';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { button, click, mount, settle, stubApi, stubBrowser, type Mounted } from '../../../test-dom';
import { DependencyReport, readDependencies } from './dependencies';

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  clearAccess();
  vi.unstubAllGlobals();
});

const REPORT: ArdentDependency[] = [
  { name: 'hivemem', status: 'usable', source: 'override', endpoint: 'https://memory.example.com', capabilities: [] },
  { name: 'hiveskills', status: 'awaiting_configuration', source: 'registry', endpoint: 'https://skills.example.com', capabilities: ['skills.pinned-release.v1'], reason: 'Magnus has no HiveSkills target credential yet' },
  { name: 'emberpath', status: 'unsupported', source: 'registry', endpoint: 'https://models.example.com', capabilities: [], reason: 'Emberpath lacks emberpath.execution-trace.v1' },
];

describe('the agent dependency report', () => {
  it('shows each dependency with its state, where it was found and why', async () => {
    view = await mount(<DependencyReport read={async () => REPORT} />);
    await settle();
    const item = (name: string) => view!.container.querySelector(`[data-dependency="${name}"]`)!.textContent ?? '';
    expect(item('hivemem')).toContain('Usable');
    expect(item('hivemem')).toContain('Explicit setting · https://memory.example.com');
    expect(item('hiveskills')).toContain('Awaiting configuration');
    expect(item('hiveskills')).toContain('Hive Registry');
    expect(item('hiveskills')).toContain('skills.pinned-release.v1');
    expect(item('emberpath')).toContain('Unsupported');
    expect(item('emberpath')).toContain('lacks emberpath.execution-trace.v1');
  });

  it('says what missing means when Magnus gives no reason', async () => {
    view = await mount(<DependencyReport read={async () => [{ name: 'emberpath', status: 'missing', source: 'none', capabilities: [] }]} />);
    await settle();
    expect(view.container.textContent).toContain('Missing');
    expect(view.container.textContent).toContain('Not resolved');
    expect(view.container.textContent).toContain('Nothing is configured, or the endpoint does not answer.');
  });

  it('asks Magnus to resolve again on Check again', async () => {
    const read = vi.fn(async (_refresh: boolean) => REPORT);
    view = await mount(<DependencyReport read={read} />);
    await settle();
    await click(button('Check again', view.container));
    await settle();
    expect(read.mock.calls.map((call) => call[0])).toEqual([false, true]);
  });

  it('explains a Magnus without the report', async () => {
    view = await mount(<DependencyReport read={async () => null} />);
    await settle();
    expect(view.container.textContent).toContain('This Magnus does not report agent dependencies');
  });

  it('reads the route, with refresh only when asked, and a 404 as no report', async () => {
    const stub = stubApi(({ path }) => (path.startsWith('/ardent/dependencies') ? { success: true, data: REPORT } : undefined));
    vi.stubGlobal('fetch', stub.request);
    await expect(readDependencies(false)).resolves.toHaveLength(3);
    await readDependencies(true);
    expect(stub.requests.map((item) => item.path)).toEqual(['/ardent/dependencies', '/ardent/dependencies?refresh=true']);
    vi.stubGlobal('fetch', stubApi(() => undefined).request);
    await expect(readDependencies(false)).resolves.toBeNull();
  });
});
