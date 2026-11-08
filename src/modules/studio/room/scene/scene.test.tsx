// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, stubBrowser, type Mounted } from '../../../magnus/test-dom';
import { defaultRoomLayout, deskOf, isoProjection, NATIVE_WIDTH, sceneScale } from './geometry';
import { ANNOUNCE_INTERVAL_MS } from './live';
import { defaultPortrait, type AgentState, type RoomLayout, type SceneAgent } from './model';
import { RoomStage, type RoomStageProps } from './stage';

const REFS = ['node-1~lead', 'node-1~world', 'node-2~carto'] as const;
const NAMES = ['Story Lead', 'Worldbuilder', 'Cartographer'];

function agent(index: number, layout: RoomLayout, state: AgentState = 'available', label = 'Available'): SceneAgent {
  const ref = REFS[index]!;
  return { ref, displayName: NAMES[index]!, roleName: `Role ${index + 1}`, portrait: defaultPortrait(ref), seat: layout.placements.find((placement) => placement.agent === ref)!.seat, state, label, since: 0 };
}
const team = (layout: RoomLayout, states: Array<[AgentState, string]> = []) => REFS.map((_, index) => agent(index, layout, ...(states[index] ?? (['available', 'Available'] as [AgentState, string]))));

let view: Mounted | undefined;
let reduce = false;
beforeEach(() => {
  stubBrowser();
  reduce = false;
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduced-motion') ? reduce : false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.fx;
});

const LAYOUT = defaultRoomLayout([...REFS]);
/** Holds the stage's props in state, so a rerender updates the same stage instead of mounting a new one. */
let update: (props: RoomStageProps) => void = () => {};
function Host({ initial }: { initial: RoomStageProps }) {
  const [props, setProps] = useState(initial);
  update = setProps;
  return <RoomStage {...props} />;
}
async function render(props: Partial<RoomStageProps> = {}) {
  const base: RoomStageProps = { agents: team(LAYOUT), layout: LAYOUT, variant: 'scene', ...props };
  view = await mount(<Host initial={base} />);
  return {
    root: view.container,
    rerender: async (next: Partial<RoomStageProps>) => {
      await act(async () => update({ ...base, ...next }));
    },
  };
}
const avatars = (root: ParentNode) => [...root.querySelectorAll<SVGGElement>('g[role="button"]')];
const avatar = (root: ParentNode, ref: string) => root.querySelector<SVGGElement>(`g[role="button"][data-agent="${ref}"]`)!;
const key = async (target: Element, keyName: string) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));
  });
};
const live = (root: ParentNode) => root.querySelector('[data-room-live]')!.textContent;

describe('the room scene', () => {
  it('is a labelled group of avatar buttons, each named with its state', async () => {
    const { root } = await render({ agents: team(LAYOUT, [['working', 'Working: drafting map'], ['asking', 'Asking: Which tone?'], ['offline', 'Offline']]) });
    const group = root.querySelector('svg[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Conversation room');
    expect(avatars(root).map((node) => [node.getAttribute('aria-label'), node.getAttribute('tabindex')])).toEqual([
      ['Story Lead, Working: drafting map', '0'],
      ['Worldbuilder, Asking: Which tone?', '0'],
      ['Cartographer, Offline', '0'],
    ]);
  });

  it('shows every state in words beside its figure, with typing dots only while working', async () => {
    const { root } = await render({ agents: team(LAYOUT, [['working', 'Working: drafting map'], ['speaking', 'Replying…'], ['queued', 'Queued: legend']]) });
    const plates = [...root.querySelectorAll('[data-plate]')].map((plate) => plate.textContent);
    expect(plates).toEqual(['Story LeadWorking: drafting map', 'WorldbuilderReplying…', 'CartographerQueued: legend']);
    expect(root.querySelectorAll('.typing-dots')).toHaveLength(1);
    expect(root.querySelector('[data-plate="node-1~lead"] .typing-dots')).not.toBeNull();
  });

  it('lights the desk of a working agent and marks a speaker with a pulsing bubble', async () => {
    const { root } = await render({ agents: team(LAYOUT, [['working', 'Working: x'], ['speaking', 'Replying…']]) });
    expect(root.querySelectorAll('.room-screen.fx-screen-glow')).toHaveLength(1);
    expect(avatar(root, REFS[1]).querySelector('.room-mark.fx-pulse')).not.toBeNull();
  });

  it('moves focus between avatars with the arrow keys, Home and End, wrapping at the ends', async () => {
    const { root } = await render();
    avatar(root, REFS[0]).focus();
    await key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-agent')).toBe(REFS[1]);
    await key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.getAttribute('data-agent')).toBe(REFS[2]);
    await key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-agent')).toBe(REFS[0]);
    await key(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement?.getAttribute('data-agent')).toBe(REFS[2]);
    await key(document.activeElement!, 'Home');
    expect(document.activeElement?.getAttribute('data-agent')).toBe(REFS[0]);
    await key(document.activeElement!, 'End');
    expect(document.activeElement?.getAttribute('data-agent')).toBe(REFS[2]);
  });

  it('opens an agent with Enter, Space or a click', async () => {
    const onSelect = vi.fn();
    const { root } = await render({ onSelect });
    await key(avatar(root, REFS[1]), 'Enter');
    await key(avatar(root, REFS[2]), ' ');
    await act(async () => avatar(root, REFS[0]).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect.mock.calls).toEqual([[REFS[1]], [REFS[2]], [REFS[0]]]);
  });
});

describe('the roster', () => {
  it('shows and hides, and lists the same agents in the same order and words as the room', async () => {
    const { root, rerender } = await render();
    const toggle = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Show roster')!;
    const roster = root.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls')!)}`)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(roster.parentElement?.hidden).toBe(true);
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide roster');
    expect(roster.parentElement?.hidden).toBe(false);

    const rows = () => [...roster.querySelectorAll('button')].map((button) => [button.getAttribute('data-agent'), button.querySelector('.room-roster__state')?.textContent]);
    const scene = () => avatars(root).map((node) => [node.getAttribute('data-agent'), node.getAttribute('aria-label')!.split(', ').slice(1).join(', ')]);
    expect(rows()).toEqual(scene());

    await rerender({ agents: team(LAYOUT, [['working', 'Working: drafting map']]) });
    expect(rows()[0]).toEqual([REFS[0], 'Working: drafting map']);
    expect(rows()).toEqual(scene());
  });

  it('follows the focused avatar and opens the same agent', async () => {
    const onSelect = vi.fn();
    const { root } = await render({ onSelect, rosterOpen: true });
    await act(async () => avatar(root, REFS[2]).focus());
    const current = root.querySelector('.room-roster [aria-current="true"]');
    expect(current?.getAttribute('data-agent')).toBe(REFS[2]);
    expect(avatar(root, REFS[2]).classList.contains('room-avatar--active')).toBe(true);
    await act(async () => (root.querySelector(`.room-roster button[data-agent="${REFS[1]}"]`) as HTMLButtonElement).click());
    expect(onSelect).toHaveBeenCalledWith(REFS[1]);
  });

  it('says so when the room is empty', async () => {
    const { root } = await render({ agents: [], rosterOpen: true });
    expect(root.querySelector('.room-roster')?.textContent).toBe('No agents are in this room yet.');
  });
});

describe('the live region', () => {
  it('announces nothing at first, then at most one change per agent every 3 s, the latest winning', async () => {
    vi.useFakeTimers();
    const { root, rerender } = await render();
    expect(live(root)).toBe('');
    await rerender({ agents: team(LAYOUT, [['queued', 'Queued: legend']]) });
    expect(live(root)).toBe('Story Lead: Queued: legend');
    await rerender({ agents: team(LAYOUT, [['working', 'Working: legend']]) });
    await rerender({ agents: team(LAYOUT, [['speaking', 'Replying…']]) });
    expect(live(root)).toBe('Story Lead: Queued: legend');
    await act(async () => vi.advanceTimersByTime(ANNOUNCE_INTERVAL_MS - 10));
    expect(live(root)).toBe('Story Lead: Queued: legend');
    await act(async () => vi.advanceTimersByTime(20));
    expect(live(root)).toBe('Story Lead: Replying…');
  });

  it('throttles each agent on its own', async () => {
    vi.useFakeTimers();
    const { root, rerender } = await render();
    await rerender({ agents: team(LAYOUT, [['queued', 'Queued: a']]) });
    await rerender({ agents: team(LAYOUT, [['queued', 'Queued: a'], ['asking', 'Asking: Tone?']]) });
    expect(live(root)).toBe('Worldbuilder: Asking: Tone?');
  });

  it('keeps quiet when nothing visible changed', async () => {
    vi.useFakeTimers();
    const { root, rerender } = await render();
    await rerender({ agents: team(LAYOUT) });
    await act(async () => vi.advanceTimersByTime(ANNOUNCE_INTERVAL_MS * 2));
    expect(live(root)).toBe('');
  });
});

describe('movement', () => {
  const transform = (root: ParentNode, ref: string) => avatar(root, ref).parentElement!.getAttribute('transform');
  const iso = isoProjection(sceneScale(NATIVE_WIDTH * 0.9));
  const at = (x: number, y: number) => {
    const point = iso.at(x, y);
    return `translate(${Math.round(point.x * 10) / 10} ${Math.round(point.y * 10) / 10})`;
  };

  it('glides to the table with requestAnimationFrame when a discussion starts', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { root, rerender } = await render();
    const home = transform(root, REFS[0]);
    await rerender({ discussion: [REFS[0]] });
    expect(frames.length).toBeGreaterThan(0);
    expect(transform(root, REFS[0])).toBe(home);
    await act(async () => {
      for (let time = 0; time <= 1000; time += 100) frames.splice(0).forEach((frame) => frame(time));
    });
    const seat = LAYOUT.seats.find((item) => item.kind === 'table')!;
    expect(transform(root, REFS[0])).toBe(at(seat.x, seat.y));
  });

  it('moves at once under reduced motion, with the same words', async () => {
    reduce = true;
    const frame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', frame);
    const { root, rerender } = await render({ agents: team(LAYOUT, [['speaking', 'Replying…']]) });
    await rerender({ agents: team(LAYOUT, [['speaking', 'Replying…']]), discussion: [REFS[0]] });
    const seat = LAYOUT.seats.find((item) => item.kind === 'table')!;
    expect(transform(root, REFS[0])).toBe(at(seat.x, seat.y));
    expect(frame).not.toHaveBeenCalled();
    expect(root.querySelector(`[data-plate="${REFS[0]}"]`)?.textContent).toContain('Replying…');
  });

  it('sends a reviewer to the review station', async () => {
    reduce = true;
    const { root } = await render({ agents: team(LAYOUT, [['reviewing', 'Reviewing map v2']]) });
    const review = LAYOUT.seats.find((item) => item.kind === 'review')!;
    expect(transform(root, REFS[0])).toBe(at(review.x, review.y));
  });

  it('draws labelled hand-off arcs and an unlabelled delivery arc to the shelf', async () => {
    const { root } = await render({ arcs: [{ id: 'h', kind: 'handoff', from: REFS[0], to: REFS[1], label: 'Name the regions' }, { id: 'd', kind: 'delivery', from: REFS[2], label: 'Delivered map.svg rev 2' }, { id: 'x', kind: 'handoff', from: REFS[0], to: 'node-9~gone', label: 'nobody' }] });
    const arcs = [...root.querySelectorAll('[data-arc]')];
    expect(arcs.map((arc) => [arc.getAttribute('data-arc'), arc.textContent])).toEqual([
      ['handoff', 'Name the regions'],
      ['delivery', ''],
    ]);
  });

  it('turns looping effects off with the low effects setting', () => {
    const effects = readFileSync(join(process.cwd(), 'src/styles/effects.css'), 'utf8');
    const low = effects.slice(effects.indexOf("html[data-fx='low']"));
    for (const hook of ['.typing-dots span', '.fx-pulse', '.fx-dash-flow', '.fx-screen-glow']) expect(low).toContain(`html[data-fx='low'] ${hook}`);
  });
});

describe('layout editing', () => {
  async function editor() {
    reduce = true;
    const onLayoutChange = vi.fn();
    const onSelect = vi.fn();
    const rendered = await render({ editing: true, onLayoutChange, onSelect });
    return { ...rendered, onLayoutChange, onSelect, status: () => rendered.root.querySelector('.room-scene [role="status"]')?.textContent };
  }
  const seatOf = (layout: RoomLayout, ref: string) => layout.placements.find((placement) => placement.agent === ref)!.seat;

  it('explains the keys, and picks up, moves and places an agent with the keyboard', async () => {
    const { root, onLayoutChange, onSelect, status } = await editor();
    const svg = root.querySelector('svg[role="group"]')!;
    expect(document.getElementById(svg.getAttribute('aria-describedby')!)?.textContent).toMatch(/Enter on an agent to pick it up/);
    const lead = avatar(root, REFS[0]);
    expect(seatOf(LAYOUT, REFS[0])).toBe('desk-1');
    await key(lead, 'Enter');
    expect(lead.getAttribute('aria-pressed')).toBe('true');
    expect(status()).toMatch(/^Moving Story Lead from Desk 1/);
    await key(lead, 'ArrowDown');
    const label = lead.getAttribute('aria-label')!;
    expect(label).toMatch(/^Story Lead, moving to /);
    expect(label).not.toBe('Story Lead, moving to Desk 1');
    await key(lead, 'Enter');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    const next = onLayoutChange.mock.calls[0]![0] as RoomLayout;
    expect(`Story Lead, moving to ${seatOf(next, REFS[0]).replace('desk-', 'Desk ').replace('table-', 'Table seat ')}`).toBe(label);
    expect(status()).toMatch(/^Placed Story Lead at /);
    expect(lead.getAttribute('aria-pressed')).toBe('false');
  });

  it('swaps two agents when one is placed on the other’s seat', async () => {
    const { root, onLayoutChange } = await editor();
    const lead = avatar(root, REFS[0]);
    await key(lead, 'Enter');
    // Desk 2 sits across the corner from desk 1, to its left on screen.
    await key(lead, 'ArrowLeft');
    expect(lead.getAttribute('aria-label')).toBe('Story Lead, moving to Desk 2');
    expect(root.querySelector('.room-scene [role="status"]')?.textContent).toBe('Desk 2, swaps with Worldbuilder.');
    await key(lead, 'Enter');
    const next = onLayoutChange.mock.calls[0]![0] as RoomLayout;
    expect(seatOf(next, REFS[0])).toBe('desk-2');
    expect(seatOf(next, REFS[1])).toBe('desk-1');
  });

  it('cancels a move with Escape and changes nothing', async () => {
    const { root, onLayoutChange, status } = await editor();
    const lead = avatar(root, REFS[0]);
    await key(lead, 'Enter');
    await key(lead, 'ArrowDown');
    await key(lead, 'Escape');
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(status()).toBe('Move cancelled. Story Lead stays at Desk 1.');
    expect(lead.getAttribute('aria-label')).toBe('Story Lead, Available');
  });

  it('moves an agent by dragging it onto a seat', async () => {
    const { root, onLayoutChange } = await editor();
    const iso = isoProjection(sceneScale(NATIVE_WIDTH * 0.9));
    const seat = LAYOUT.seats.find((item) => item.id === 'table-3')!;
    const target = iso.at(seat.x, seat.y);
    const start = iso.at(deskOf(LAYOUT.seats[0]!).x, deskOf(LAYOUT.seats[0]!).y);
    const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    await act(async () => avatar(root, REFS[0]).dispatchEvent(pointer('pointerdown', start.x, start.y)));
    const svg = root.querySelector('svg[role="group"]')!;
    await act(async () => svg.dispatchEvent(pointer('pointermove', target.x + 4, target.y - 3)));
    await act(async () => svg.dispatchEvent(pointer('pointerup', target.x + 4, target.y - 3)));
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(seatOf(onLayoutChange.mock.calls[0]![0] as RoomLayout, REFS[0])).toBe('table-3');
  });

  it('drops nothing when a drag ends far from every seat', async () => {
    const { root, onLayoutChange } = await editor();
    const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    await act(async () => avatar(root, REFS[0]).dispatchEvent(pointer('pointerdown', 10, 10)));
    const svg = root.querySelector('svg[role="group"]')!;
    await act(async () => svg.dispatchEvent(pointer('pointermove', 2, 2)));
    await act(async () => svg.dispatchEvent(pointer('pointerup', 2, 2)));
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it('opens nothing on click while editing', async () => {
    const { root, onSelect } = await editor();
    await act(async () => avatar(root, REFS[0]).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('narrow screens', () => {
  it('draws the team in a ring around the display wall, with the same avatars and keys', async () => {
    const onSelect = vi.fn();
    const { root } = await render({ variant: 'ring', onSelect, wall: { focus: 'Map legend', decisions: 2 } });
    expect(root.querySelector('[data-variant="ring"]')).not.toBeNull();
    expect(avatars(root).map((node) => node.getAttribute('aria-label'))).toEqual(['Story Lead, Available', 'Worldbuilder, Available', 'Cartographer, Available']);
    expect(root.querySelector('.room-board--compact')?.textContent).toContain('Map legend');
    avatar(root, REFS[0]).focus();
    await key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-agent')).toBe(REFS[1]);
    await key(document.activeElement!, 'Enter');
    expect(onSelect).toHaveBeenCalledWith(REFS[1]);
  });

  it('follows the screen width when the variant is automatic', async () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const { root } = await render({ variant: 'auto' });
    expect(root.querySelector('[data-variant="ring"]')).not.toBeNull();
  });
});

describe('the display wall', () => {
  it('shows empty slots as empty, never made-up text', async () => {
    const { root } = await render({ wall: { questions: 0 } });
    const slots = [...root.querySelectorAll('.room-board__slot')].map((slot) => slot.textContent);
    expect(slots).toEqual(['BriefNone yet', 'FocusNone yet', 'DecisionsNone yet', 'Questions0']);
  });
});
