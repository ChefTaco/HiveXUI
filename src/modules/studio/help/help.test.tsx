// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { button, click, mount, stubBrowser, type Mounted } from '../../magnus/test-dom';
import { STUDIO_ROUTES } from '../routes';
import { guideFor, STUDIO_GUIDES } from './guides';
import { StudioHelp } from './help-button';

let view: Mounted | undefined;
beforeEach(() => stubBrowser());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});

const drawer = () => document.querySelector<HTMLElement>('[role="dialog"].drawer');
const press = async (key: string) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

describe('the Studio "?" guide', () => {
  it('opens the area guide in a drawer from a labelled button', async () => {
    view = await mount(<StudioHelp guide={STUDIO_GUIDES.room} />);
    const help = button('Help: Conversation Room', view.container)!;
    expect(help).toBeDefined();
    expect(help.getAttribute('aria-haspopup')).toBe('dialog');
    expect(help.getAttribute('aria-expanded')).toBe('false');
    expect(drawer()).toBeNull();

    await click(help);
    expect(help.getAttribute('aria-expanded')).toBe('true');
    expect(drawer()?.getAttribute('aria-label')).toBe('Conversation Room');
    expect(drawer()?.textContent).toContain('Keys in the room');
    expect([...drawer()!.querySelectorAll('kbd')].map((key) => key.textContent)).toContain('g r');
    expect(drawer()!.contains(document.activeElement)).toBe(true);
  });

  it('closes with Escape and gives focus back to the button', async () => {
    view = await mount(<StudioHelp guide={STUDIO_GUIDES.team} />);
    const help = button('Help: Team Assignment', view.container)!;
    help.focus();
    await click(help);
    expect(drawer()).not.toBeNull();
    await press('Escape');
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(help);
    expect(help.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes with its Close button and gives focus back to the button', async () => {
    view = await mount(<StudioHelp guide={STUDIO_GUIDES.projects} />);
    const help = button('Help: Projects', view.container)!;
    help.focus();
    await click(help);
    await click(button('Close', drawer()!));
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(help);
  });
});

describe('the guides', () => {
  it('cover every Studio page with the guide for its area', () => {
    const area = Object.fromEntries(STUDIO_ROUTES.map((route) => [route.id, guideFor(route.id).area]));
    expect(area).toEqual({
      home: 'projects',
      new: 'projects',
      project: 'projects',
      gallery: 'team',
      team: 'team',
      'team-gallery': 'team',
      room: 'room',
      agent: 'agents',
      'project-agent': 'agents',
      review: 'agents',
    });
    expect(guideFor(null).area).toBe('projects');
  });
});
