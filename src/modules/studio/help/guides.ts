// The in-product "?" guides, one per Studio area. All of their text is here, so it is kept in step
// with docs/STUDIO.md in one place: each guide is a short version of that page's section. Pure data.
import type { StudioRouteId } from '../routes';

export type GuideArea = 'projects' | 'team' | 'room' | 'agents';

export interface GuideKey {
  /** The keys, as written in docs/STUDIO.md's keyboard tables. */
  keys: string;
  action: string;
}

export interface GuideSection {
  heading: string;
  points?: readonly string[];
  keys?: readonly GuideKey[];
}

export interface StudioGuide {
  area: GuideArea;
  /** The drawer title, and the name in the help button's label. */
  title: string;
  summary: string;
  sections: readonly GuideSection[];
}

const CLOSE: GuideSection = {
  heading: 'Leaving Studio',
  points: [
    'Close Studio (✕) returns to the console page you opened Studio from, or to the suite home.',
    'Escape never closes Studio. It closes the open drawer, dialog, menu or card, and focus returns to what opened it.',
  ],
};

export const STUDIO_GUIDES: Readonly<Record<GuideArea, StudioGuide>> = {
  projects: {
    area: 'projects',
    title: 'Projects',
    summary: 'A project gives a team of Ardent agents a shared brief, references and deliverables. It holds many conversations, tasks and revisions.',
    sections: [
      {
        heading: 'Projects home',
        points: [
          'Search by name, brief or tags. Switch between Active and Archived, and use Needs review for projects with a delivery waiting.',
          'Each card shows the team, open work, references, the last recorded activity, and badges for open questions and reviews.',
        ],
      },
      {
        heading: 'Create a project',
        points: [
          'Brief: name, brief in Markdown, audience, tags, constraints and the deliverables you want, with their formats. Agents read the brief on their first turn.',
          'References: upload files up to 64 MiB each, or add links. Each file shows Indexing, Indexed or Failed (with Retry) as it goes into the project’s HiveMem workspace.',
          'Starting team: a template, a copy of another project’s team, or blank. You can also ask an agent to propose a team from the brief.',
          'Team Assignment opens next: bind each role, then Start in Room.',
        ],
      },
      {
        heading: 'In a project',
        points: [
          'The top bar has the project switcher, the Team, Room and Agents tabs, Files for references and links, and Archive or Reopen.',
          'Archive makes the project read-only. Running tasks must be cancelled first.',
          'Studio needs at least one reachable Ardent agent in Magnus. Without one, every page says so, with Refresh.',
        ],
      },
      CLOSE,
    ],
  },
  team: {
    area: 'team',
    title: 'Team Assignment',
    summary: 'Design the team as a draft, bind each role to an Ardent agent, publish, then start in the Room.',
    sections: [
      {
        heading: 'Design and publish',
        points: [
          'Team is the canvas, Workflow shows the stages, and Table edits everything the canvas does. Narrow screens open Table.',
          'Edits save to a draft revision. Publish makes it current; errors in Validate block it.',
          'Start in Room needs a published team whose coordinator is bound to an available agent.',
          'Running tasks keep the revision they started under. Reassign moves one to the current revision.',
        ],
      },
      {
        heading: 'Roles and agents',
        points: [
          'Select a role to open its inspector: responsibilities, instructions, deliverables, skills and relationships.',
          'Bind existing picks an Ardent profile from Magnus. New agent runs Magnus’s New Agent wizard; the role is bound once the agent answers. Creating an agent needs a Magnus ADMIN.',
          'Lines are Reports to, Delegates to, Hands off to and Reviews. New lines sets the type a drawn line gets.',
        ],
      },
      {
        heading: 'Proposals and templates',
        points: [
          'Propose team asks an agent for roles and bindings from the brief. The difference shows as a ghost on the canvas: Accept all, accept chosen roles, or Discard.',
          'The Gallery has team and agent templates. Projects pin the version they used; a newer version shows Review changes, and nothing updates on its own.',
        ],
      },
      {
        heading: 'Keys on the canvas',
        keys: [
          { keys: 'Tab', action: 'Next role, in reporting order' },
          { keys: 'Enter', action: 'Open the role inspector' },
          { keys: '↑', action: 'The role’s manager' },
          { keys: '↓', action: 'The role’s first report' },
          { keys: '← / →', action: 'Previous or next sibling' },
          { keys: 'Delete or Backspace', action: 'Delete the role (asks first)' },
          { keys: 'Shift + arrow', action: 'Nudge the card' },
          { keys: 'A', action: 'Auto-layout' },
          { keys: 'Ctrl/Cmd + D', action: 'Duplicate the role' },
        ],
      },
    ],
  },
  room: {
    area: 'room',
    title: 'Conversation Room',
    summary: 'Talk to the coordinator, one role or the whole team. The room shows what each agent is doing, from real records only.',
    sections: [
      {
        heading: 'Talking to the team',
        points: [
          'Send to Team (the coordinator answers), Coordinator or a role. @role mentions start a turn for each role mentioned; the line under the box says who will answer.',
          'Replies stream into their bubble. When a reply finishes, the stored message replaces the live text.',
          'Message actions: reply, reply in thread, pin as decision, create task, request follow-up and copy link.',
          'Start discussion asks chosen roles a question for one to four rounds.',
        ],
      },
      {
        heading: 'Agents and tasks',
        points: [
          'Every agent shows its state in words: Replying…, Working, Queued, Waiting, Asking, Reviewing, Paused, Delivered, Available, Offline or Unknown.',
          'Select an agent for its card: current task, last message, Open in Agent Studio, Message directly and Invite to discussion.',
          'Tasks groups work into Assignments, Blockers, Questions, Review requests and Recent outcomes, with Pause, Resume, Cancel and Reassign.',
          'Show roster lists the same agents and states as text. Edit layout moves agents between seats; Save layout stores it.',
        ],
      },
      {
        heading: 'Keys in the room',
        keys: [
          { keys: 'g r', action: 'Focus the room (the first agent)' },
          { keys: 'g t', action: 'Focus the transcript' },
          { keys: 'g c', action: 'Focus the composer' },
          { keys: '← ↑ / → ↓', action: 'Previous or next agent (wraps)' },
          { keys: 'Enter or Space', action: 'Open the agent card' },
          { keys: 'Shift + Enter', action: 'New line' },
        ],
      },
      {
        heading: 'Keys while editing the layout',
        keys: [
          { keys: 'Enter or Space', action: 'Pick up the focused agent, then place it' },
          { keys: 'Arrow keys', action: 'Choose the next seat in that direction' },
          { keys: 'Escape', action: 'Cancel the move; the agent stays' },
        ],
      },
    ],
  },
  agents: {
    area: 'agents',
    title: 'Agent Studio and Review',
    summary: 'Tune one agent and review what it delivers. Opened from a project, it also shows the agent’s role and work there.',
    sections: [
      {
        heading: 'Agent Studio',
        points: [
          'Identity: name and portrait (Global), the project role (This project only), and SOUL.md and IDENTITY.md with history and restore.',
          'Capabilities: skills, model, channels and peers, and active tasks. Skill and model changes take effect when the profile restarts.',
          'Knowledge: the project’s references in HiveMem, and the agent’s memory, private to it.',
          'Preview: edit a draft and chat with the agent as the draft would make it. Previews write no memory and change nothing. Save draft, Apply through Magnus (needs a Magnus ADMIN), or Discard.',
          'Development: the agent’s own records. Comment keeps a note in Studio; Discuss with agent also records it with the agent.',
        ],
      },
      {
        heading: 'Review',
        points: [
          'Pick a deliverable and revision. Files are checked against their digest before they are shown.',
          'Select text, or drag a region on an image or PDF, to comment on it. Any file takes a comment on the whole file.',
          'Compare with another revision: words or lines, side by side or inline; images side by side, swipe or overlay; PDF page by page.',
          'Tick open comments and Request revision to send them back to the producer.',
          'Accept, Request changes or Reject. Mark final picks one revision per deliverable; Export package zips the final revisions.',
        ],
      },
    ],
  },
};

const AREA_OF: Readonly<Record<StudioRouteId, GuideArea>> = {
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
};

/** The guide for a Studio page; an address no page has gets the Projects guide. */
export const guideFor = (route: StudioRouteId | null | undefined): StudioGuide => STUDIO_GUIDES[route ? AREA_OF[route] : 'projects'];
