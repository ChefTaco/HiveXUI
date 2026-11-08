# Ardent Project Studio

Ardent Project Studio gives a team of Ardent agents a shared project. You write a brief, design a
team and bind each role to an agent that Magnus manages, then talk to the team in a Conversation
Room, tune each agent in Agent Studio and review what it delivers. A project outlives any one chat
session or run: it holds many conversations, tasks, team revisions and deliverable revisions.

HiveXUI is the browser side. The records live in the ArdentStudio service; the agents live in
Ardent, managed through Magnus. This page describes the console as it is in this repository. The
in-product **?** guides in the Studio top bar are short versions of the sections below; their text
is in `src/modules/studio/help/guides.ts`.

## Requirements

| Needs | Why | Without it |
| --- | --- | --- |
| The ArdentStudio service, at `/api/ardentstudio` | Projects, teams, conversations, tasks, files and reviews are its records | The Studio entries are not in the sidebar. If it is configured but does not answer, the top bar says **Offline** and each page says what it would show, with **Retry** |
| Magnus, with at least one reachable Ardent agent | Every role is bound to a Magnus-managed Ardent profile | Every page shows **"Ardent Project Studio needs at least one Ardent agent."** with **Refresh**, and **New Agent** (Magnus's New Agent wizard in a drawer; the panel checks again when it finishes) for a Magnus ADMIN or a link to **Ardent profiles** in Fleet for anyone else |
| HiveMem | Each project has a HiveMem workspace that its references are indexed into, and each agent keeps private memory | Pages work, with a banner: references are stored but agents cannot search them |
| Oathweave | Sign-in, and the identity the service checks on every request | An identity the service refuses sees **No access** in the top bar |

The sidebar shows a **Studio** section (Projects, Gallery) only when `runtime.json` configures
`ardentstudio` with its API prefix and public client, and the Hive Registry lists it as installed.
The top bar checks the service's readiness every 30 seconds while the tab is visible, and names any
dependency the service reports down (Magnus, HiveMem, or no available agent).

Some actions also need a Magnus **ADMIN**: creating an agent with New Agent and applying changes to
an agent from Agent Studio. Magnus checks this for the signed-in person, not for the service.

## The fullscreen page

Studio opens as a fullscreen page under `/studio`, outside the console's sidebar and top bar. Its
own top bar has:

- the Studio mark, which goes to the Projects home;
- inside a project, the **project switcher** (search the active projects, **All projects**,
  **New project**), the area tabs **Team · Room · Agents**, **Files** with its count of references
  and links (and how many failed to index), and **Archive** or **Reopen**;
- the connection state: **Connecting…**, **Connected**, **No access** or **Offline**;
- a **?** button that opens the guide for the area you are in;
- **✕ Close Studio**.

✕ returns to the console page Studio was opened from. That address travels in `history.state` with
every Studio page, so it survives a reload, Back and Forward. Without a stored origin, or with one
that is not a console page, ✕ goes to the suite home. **Escape does not close Studio**, so a stray
key cannot throw away a room or a review in progress; Escape only closes the drawer, dialog, menu
or card that has focus.

The **Agents** tab opens the agent you last opened in that project, or the project-wide Review
when there is none. `/studio/p/:projectId` opens the project's last area; a new project opens
Team Assignment until its coordinator is bound, then the Room.

## Routes

| Address | Page | Query parameters |
| --- | --- | --- |
| `/studio` | Projects home | `status=archived`, `q=` search, `review=1` needs review |
| `/studio/new` | Create a project | `step=2` or `3`, `project=` the project being created, `template=` a team template to start from |
| `/studio/gallery` | Gallery outside a project | `kind=agents` (default teams), `q=`, `source=seed` or `user`, `category=`, `archived=1`, `template=id` or `id@version` |
| `/studio/agents/:agentRef` | Agent Studio without a project | `tab=` as below |
| `/studio/p/:projectId` | The project's last area | |
| `/studio/p/:projectId/team` | Team Assignment ▸ Designer | `view=team`, `workflow` or `table`; `role=` the open role; `start=1` shows "Bind each role, then Start in Room." |
| `/studio/p/:projectId/team/gallery` | Team Assignment ▸ Gallery | as `/studio/gallery` |
| `/studio/p/:projectId/room` | Conversation Room | `c=` conversation (default the team room), `m=` message, `task=` task (opens Tasks), `agent=` agent card |
| `/studio/p/:projectId/agents/:agentRef` | Agent Studio in a project | `tab=identity`, `capabilities`, `knowledge`, `preview`, `development` or `review`; `from=room` with `c=` and `m=` adds **Back to the room** |
| `/studio/p/:projectId/review` | Review, the whole project | `d=` deliverable, `rev=` revision, `compare=` revision to compare with, `comment=` focused comment |

`agentRef` is `<nodeId>~<profile>`, the Magnus profile reference. Project ids and agent refs are
checked before a page opens; anything else is **Not found**.

## Projects

**Home** lists projects as cards: name, brief, team line (bound roles and revision), work and
references, the last recorded activity, and badges for open questions and deliveries waiting for
review. Search covers the name, brief and tags. **Active** and **Archived** switch the list, and
**Needs review** keeps projects with a delivery waiting.

**Create a project** has three steps:

1. **Brief.** Name, brief (Markdown), audience, tags, constraints and requested deliverables, each
   with a name, kind, formats (`.md`, `.docx`, `.pdf`, `.svg`, `.png`, and more) and optional stage.
   Agents read the brief on their first turn.
2. **References.** Upload files up to 64 MiB each (Markdown, text, CSV, JSON, DOCX, PDF or images)
   and add links. Each file shows its indexing state: Stored, Queued, Indexing, **Indexed**,
   **Failed** (with **Retry**) or Not indexable. Links index their title, address and note; the
   page itself is not fetched. Indexing continues in the background.
3. **Starting team.** From a template, a copy of another project's team (optionally keeping its
   bindings), or blank. Optionally ask an agent to **propose a team from the brief**.

Team Assignment then opens with **"Bind each role, then Start in Room."**

**Files** in the top bar manages references and links later. **Archive** makes a project read-only;
the service refuses while tasks are running and lists them. **Reopen** restores it.

## Team Assignment

The designer edits a **draft revision** of the team. It saves as you go, and **Publish** makes it
current. Every task records the revision it started under. **Start in Room** needs a published team
whose coordinator is bound to an available agent; until then the button says why.

- **Views.** **Team** is the canvas; **Workflow** shows the stages (create, research, discuss,
  review, revise, deliver); **Table** edits everything the canvas does. Table is the default on a
  narrow screen, where the role inspector is a fullscreen drawer.
- **Toolbar.** **+ Role**, **Auto-layout**, **New lines** (the relationship type a drawn line
  gets), **Propose team**, and **Validate (n)**, which lists every issue.
- **Relationships.** **Reports to** (structure: one tree under one coordinator), **Delegates to**
  (who may assign work), **Hands off to** (workflow; no cycles except a revise loop) and
  **Reviews**. They can also be added and edited in the inspector.
- **Role inspector.** Name, coordinator, stage, responsibilities and instructions (Markdown),
  contributions, deliverables, skills, knowledge and relationships. **Bind existing** picks a
  Magnus-managed Ardent profile; **New agent** opens Magnus's New Agent wizard in a drawer; then
  **Unbind**, **Duplicate** (without the binding), **Save as agent template** and **Delete role**.
  A role with work (active tasks, or deliverables it produced) asks first and says what it has; a
  role without work is deleted at once, with **Undo** on the notice to put it back with its
  relationships.
- **Validation.** Errors block Publish: not exactly one coordinator, a reporting cycle, a hand-off
  cycle that is not a revise loop, a deliverable no role produces, and malformed roles or
  relationships (a repeated key, a relationship to an unknown role or to itself, a coordinator that
  reports, two managers).
  Warnings: an unbound role, a reviewer who is also the only producer, a skill not enabled on the
  bound agent, an unavailable agent, an agent without HiveMem, a role outside the coordinator's
  tree, and agent facts Magnus could not report.
- **Active work.** Running tasks show **"Working under r3 (current r4)"**. **Reassign** cancels the
  task and recreates it under the current revision.
- **Template updates.** When the pinned template has a newer version, **Review changes** shows a
  per-field diff that you can apply to the draft. Nothing updates on its own.

**New agent** runs Magnus's New Agent wizard (Node, Identity, Model, Review, Deploy). Deploy streams
each step: create the profile, start the service, write `SOUL.md` and `IDENTITY.md`, enroll the
HiveMem identity, configure the model and memory, enable skills, restart, and wait for the agent to
answer. The role is bound only when the last check answers. It needs a Magnus ADMIN.

**Propose a team from the brief** asks an agent (the coordinator by default) for roles,
relationships, stages and suggested agents. The answer is validated, and retried once with the
error if it is invalid. It appears as a ghost diff on the canvas and in the table: added, changed
and removed roles and lines. **Accept all**, **Accept n roles** or **Discard**; nothing is applied
until you accept.

### Gallery

**Teams** and **Agents** templates, with search and filters for source (Seed or Mine), category and
archived. A template shows its purpose, example uses, roles (teams) or persona (agents),
requirements and integrations, **What will happen** when you use it, and its versions with "used
by n projects". Actions: **Use in project** (or **Use in a new project**), **Customize** (saves a
new version), **Duplicate as variant**, **Archive**. Versions are immutable and projects pin the
version they used.

## Conversation Room

The room shows the published team's agents at their desks beside the transcript of the open
conversation, with an activity strip below: Assignments, Blockers, Questions, Review requests and
Recent outcomes. Each opens the **Tasks** drawer at that group.

| Width | Layout |
| --- | --- |
| 1024 px and wider | Room and transcript side by side with a splitter (40% to 75%, 60% by default, remembered in this browser) |
| Below 1024 px | **Room**, **Transcript** and **Activity** tabs |
| Below 640 px | A compact ring of agents around the display wall, then the activity strip and the transcript |

- **Conversations.** The team room, direct conversations with one role, and discussions, chosen
  in the header. **Start discussion** takes participants, a question, a desired output (decision,
  short doc or options) and 1 to 4 rounds; **Stop discussion** cancels turns not yet started.
- **Composer.** Send to **Team** (the coordinator answers), **Coordinator**, or a role. `@role`
  mentions start a turn for each role mentioned. The line under the box says who will answer.
  Attach uploads or project files. Enter sends; Shift+Enter starts a new line.
- **Messages.** Reply, Reply in thread, Pin as decision, Create task, Request follow-up and Copy
  link. Questions from agents show an answer card; the answer continues the same agent session.
- **Agent card.** Click an agent, or press Enter on it, for its current task (with its controls),
  its last message, **Open in Agent Studio**, **Message directly** and **Invite to discussion**.
- **Tasks drawer.** Each task shows its role, mode, team revision and source, with **Pause**,
  **Resume**, **Cancel** and **Reassign** as its state allows. A control says what it is waiting
  for ("Pause requested…") until the task's own state confirms it ("Paused").
- **Decisions** lists pinned decisions; **New decision** pins one without a source message.
- **Edit layout** moves agents between desks, discussion seats and the review station, and renames
  the zones. **Save layout** stores a new layout revision; if someone saved in the meantime,
  **Reload layout** fetches theirs. Layout editing is not offered on a phone-sized screen.

### Agent states

Each agent shows one state, with its words beside it, in the scene, the roster and the agent card.
States come only from real records, never guesses: the room shows no idle wandering, fake typing,
reasoning or tool contents.

The ArdentStudio service is the single source of an agent's activity. It derives one state and its
words per agent in the project from its task records, the Ardent journal, verified deliverable
revisions and a profile probe every 30 seconds, and sends each change on the project stream (see
ArdentStudio's `docs/CONDUCTOR.md`, Activity). The room (`room/room-presence.ts`) shows that state
and those words as they are. The browser adds one thing on top: **a live reply wins**. From the
first live text of a reply until its stored message completes the agent is Speaking,
"Replying…", and for 4 seconds after that, "Replied". Before the service has sent anything the agent
is Unknown, "Status not checked yet".

| State | Set by | Visual | Text, as the service writes it |
| --- | --- | --- | --- |
| Speaking | The browser: a reply streaming, and 4 s after it completes | Pulsing speech bubble; the transcript bubble fills in | "Replying…", then "Replied" |
| Offline | The profile probe failed | Desaturated portrait | "Offline", or "Offline: Magnus is unreachable" |
| Available | The probe answered and nothing below applies | No mark | "Available" |
| Queued | A task waiting to start, or accepted before the model has started | Clock mark | "Queued: \<task\>", or "Starting: \<task\>" |
| Waiting | A task held until an earlier turn in its group finishes, or a role the agent handed work to that has not finished | Hourglass mark | "Waiting for \<role\>" |
| Working | A running task once the journal shows the model started or a tool step | Lit desk screen; typing dots beside the words | "Working: \<task\>", with " · \<tool\>" for a tool step |
| Reviewing | A running review task | Magnifier mark; stands at the review station | "Reviewing: \<task\>" |
| Asking | A question the agent asked that nobody has answered, or a task waiting for input | "?" mark | "Asking: \<question\>" |
| Paused | A pause requested, then taken at a step boundary | Pause mark | "Pause requested: \<task\>", then "Paused: \<task\>" |
| Blocked | The agent's newest task failed, ended in an unknown Ardent state or reported itself blocked; new work clears it | "No entry" mark in the danger color | "Blocked: \<reason\>" |
| Delivering | A deliverable revision received from the agent, for 20 seconds | Package mark; an arc to the delivery shelf | "Delivered \<name\> r\<n\>" |
| Unknown | Not probed yet | Dashed-circle mark | "Status not checked yet" |

When several apply to one agent (several tasks at once), the service shows the first in this order:
Offline, Paused, Blocked, Asking, Reviewing, Working, Queued, Waiting, Delivering, Available,
Unknown. Failed tasks also show in the Tasks drawer's **Blockers** group and on the activity strip.

Arcs are drawn for 8 seconds: a labelled hand-off arc between two agents when the transcript
shows an allowed hand-off, and a delivery arc to the shelf for each revision that arrives while the
room is open ("Delivered \<name\> rev n"). Participants of a running discussion gather at the table. When
the service sends a fresh snapshot, every agent's activity is replaced by it.

### Streaming

Replies stream. A reply bubble opens with the first live text and fills in as it arrives, rendered
as Markdown by the same renderer as a finished message, so headings, lists, emphasis and code show
while they arrive and the bubble does not change shape when the reply completes. Partial Markdown is
safe: an open code fence shows as code to the end, an unclosed emphasis shows its marker until it
closes, and raw HTML is never rendered. When the reply finishes, the stored message replaces the
bubble's text: the final message is authoritative, and live text is only a view of it. A step that starts with structured output (JSON) shows
"Working…" until plain text arrives, so raw JSON never streams into the transcript. Opening a
conversation while a reply streams starts from the text so far.

The project stream resumes from the last event it applied. If it skips an event or the service
resets it, the page reads the project and the open conversation again ("Catching up…"). The header
shows **Live**, **Connecting**, **Reconnecting** or **Offline**.

## Agent Studio

The header shows the agent's name and portrait, its profile and node, the Ardent version and
backend, runtime status, HiveMem status, the projects using it, and **Fleet details**. Opened from
the room, it also has **Back to the room**. The other way, each Ardent profile page in Fleet has
**Open in Studio** when this console has Ardent Project Studio; Studio's ✕ returns to that page.

1. **Identity.** Name and portrait (**Global**), the **Project role** (**This project only**), and
   `SOUL.md` and `IDENTITY.md` with history and restore.
2. **Capabilities.** Local skills, the HiveSkills catalog, the model (with Emberpath aliases),
   channels and peers, and active tasks. Skill and model changes take effect when the profile
   restarts. Search the catalog, choose a skill and **Install** its stable release, optionally
   enabled in the same step: the Studio service asks Magnus (`skill-install`) for the signed-in
   person, who must be a Magnus ADMIN; Magnus fetches the release from its HiveSkills registry and
   checks it against the catalog digest. The same picker is on the Skills tab of the agent's Magnus
   profile page. It needs a node agent at Studio level 3; below that it asks for an agent upgrade,
   and with an older Magnus or Studio service it says which to upgrade.
3. **Knowledge.** The project's references from its HiveMem workspace, and the agent's own memory,
   labelled **Private to this agent**.
4. **Preview.** A draft (SOUL, IDENTITY, skills, model) beside a streaming preview chat. Previews
   write no memory, keep no files and change nothing on the agent. **Save draft** keeps it on the
   service; **Apply** changes the agent through Magnus with its revisions kept in history;
   **Discard** drops it. When the agent has running work: "Applies from the agent's next turn; n
   running tasks keep current instructions." Apply reports each part as Applied, Unchanged, Failed
   or Not applied here, and says when the profile needs a restart.
5. **Development.** A timeline of the agent's development records: observations, reflections, open
   questions, communication changes, self-understanding, identity and instruction revisions and
   skill changes, each marked **Agent-reported** where the agent wrote it. **Comment** keeps a note
   in Studio; **Discuss with agent** also records it in the agent's development history. A runtime
   that does not publish records says so, and identity history still shows.
6. **Review.** Deliverable Review for this agent; switch to **Whole project** to see every
   deliverable.

## Review

Review lists the project's deliverables with filters for status, producer and kind, and, inside
Agent Studio, **This agent** or **Whole project**. A revision is downloaded once and checked against
its SHA-256 digest before it is shown. Each revision has a review status: New, Changes requested,
Accepted, Rejected or Superseded.

**Previews**, one renderer per type:

| Type | Preview | Comment anchors |
| --- | --- | --- |
| Markdown | Rendered | A selected passage, by its offsets and quote in the source |
| Plain text, CSV, JSON | Text | A selected passage, by offsets and quote |
| Images (PNG, JPEG, WebP, GIF, SVG) | An `<img>` from a `blob:` URL; SVG is never inlined | A dragged region, normalized; SVG regions also carry `viewBox` coordinates, and **Source** takes text comments |
| PDF | pdf.js, a page at a time with selectable text and zoom | A selected quote on a page, or **Mark a region** and drag |
| Word (.docx) | The service's conversion, as paragraphs | A selected passage inside one paragraph, by paragraph id |
| Anything else | Name, type, size and **Download** | The whole file |

Every file also takes a comment on the **whole file**.

**Compare** (choose a revision to compare with): text, Markdown and Word by words or lines,
side-by-side or inline; images side-by-side, swipe or overlay; PDF as page pairs.

**Comments** can be filtered (Open, Resolved, All). Tick open comments and **Request revision** to
send them back to the producer role with prefilled instructions; they then show the revision task,
and later the revision that answers them. **Resolve** is manual.

**Decisions**: **Accept**, **Request changes** (needs a note when there are no open comments) and
**Reject**. **Mark final** picks one revision per deliverable (not a rejected one). **Export
package** builds a zip of the final revisions with a manifest and the decisions, and keeps earlier
exports to download again. An archived project is read-only here too.

## Keyboard

Studio-wide: Tab and Shift+Tab move through controls; Escape closes the open drawer, dialog, menu
or card and returns focus to what opened it. Escape never closes Studio.

**Team Assignment canvas** (a role card has focus):

| Keys | Action |
| --- | --- |
| Tab | Next role, in reporting order |
| Enter | Open the role inspector |
| ↑ | The role's manager |
| ↓ | The role's first report |
| ← / → | Previous or next sibling |
| Delete or Backspace | Delete the role (asks first when it has work; otherwise Undo) |
| Shift + arrow | Nudge the card |
| A | Auto-layout |
| Ctrl/Cmd + D | Duplicate the role |

**Conversation Room**:

| Keys | Action |
| --- | --- |
| g r | Focus the room (the first agent) |
| g t | Focus the transcript |
| g c | Focus the composer |
| ← ↑ / → ↓ | Previous or next agent (wraps) |
| Home / End | First or last agent |
| Enter or Space | Open the agent card |
| Escape | Close the agent card; focus returns to the agent |
| Enter | Send the message |
| Shift + Enter | New line |
| @ | Mention a role; ↑ ↓ choose, Enter or Tab insert, Escape closes the list |
| ← → on the splitter | Resize the room and transcript in 5% steps; Home and End for the limits |

The `g` shortcuts take the second key within 1.5 seconds. They do nothing while you type in a field
or while a drawer or form is open.

**Layout editing** (after **Edit layout**):

| Keys | Action |
| --- | --- |
| Enter or Space | Pick up the focused agent |
| Arrow keys | Choose the next seat in that direction; the status line says when it swaps with someone |
| Enter or Space | Place the agent there |
| Escape | Cancel the move; the agent stays |

A pointer can drag an agent onto a seat instead. **Save layout** stores the change; **Cancel**
drops it.

## Accessibility

- The room is an SVG `role="group"` labelled with the number of agents. Each agent is a focusable
  button named "\<role\>, \<state text\>", so a screen reader hears the same words that are shown.
- **Show roster** opens a list of the same agents, in the same order and with the same words, as a
  text equivalent of the scene. Selecting an agent there opens its card.
- A polite live region announces state changes as "\<role\>: \<state text\>", at most one per agent
  every 3 seconds; the latest change wins. A finished reply is announced once, as "\<role\>
  replied: \<start of the reply\>", never per streamed chunk. The transcript list itself is not a
  live region.
- Every state has visible text; color and motion only repeat it. Status colors are used only for
  states that are statuses (Asking, Blocked); portrait accents identify agents and never mean a
  status.
- Under `prefers-reduced-motion`, agents move to new places at once instead of gliding, and no
  animation runs. Under `html[data-fx='low']`, looping effects stop: the speech-bubble pulse, the
  typing dots, the glow on a lit desk, the streaming cursor and the moving dashes on arcs.
- Narrow screens keep every function except layout editing. Drawers take the full width of a
  phone screen.
- Layout editing explains its keys to screen readers and reports each seat change in a status line.

## Known limits

- **Word preview.** Word documents show as plain paragraphs from the service's conversion. The
  page view waits for the canvas engine package to be published; comment anchors (paragraph ids)
  will stay the same. When the service has no Word converter, Review says so and offers the
  download.
- **HiveSkills install** needs a Magnus release with `skill-install` and its HiveSkills registry
  configured (`MAGNUS_ARDENT_HIVESKILLS_URL`); otherwise Install says what is missing. Only the
  stable channel's release is offered.
- **Apply needs a Magnus release** that runs agent changes for the Studio service on behalf of the
  signed-in Magnus ADMIN. With an older Magnus, or without that role, each part of Apply fails with
  Magnus's reason (for example "Only a Magnus administrator can change an agent").
- **PDF quote highlight.** A comment on selected PDF text opens its page, but the quoted text is
  not highlighted on the page. Region comments on PDFs and images are drawn.
