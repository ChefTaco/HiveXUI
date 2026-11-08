// Fake review records for tests. Tests only; nothing in the console imports it.
import { PROJECT_ID } from '../test-fixtures';
import type { Deliverable, ReviewComment, Revision } from './api';

const id = (prefix: string, n: number) => `${prefix}_01HZX3K6Q1V8R2M4N6P8T0W${String(n).padStart(3, '0')}`;
export const DELIVERABLE_ID = id('dlv', 1);
export const REVISION_ID = id('drv', 1);
export const REVISION_2_ID = id('drv', 2);
const AT = '2026-11-08T10:00:00.000Z';

export const revision = (overrides: Partial<Revision> = {}): Revision => ({
  id: REVISION_ID,
  deliverable_id: DELIVERABLE_ID,
  revision: 1,
  blob_sha256: 'a'.repeat(64),
  mime: 'text/plain',
  size: 18,
  producer_binding_id: id('bnd', 2),
  source_task_id: id('tsk', 1),
  source_message_id: null,
  ardent: { agent_ref: 'node-1~world', manifest: { name: 'notes.txt' } },
  supersedes_revision_id: null,
  received_at: AT,
  review_status: 'unreviewed',
  ...overrides,
});

export const deliverable = (overrides: Partial<Deliverable> = {}): Deliverable => ({
  id: DELIVERABLE_ID,
  project_id: PROJECT_ID,
  requested_deliverable_id: null,
  name: 'Adventure notes',
  kind: 'document',
  producer_role: 'world',
  final_revision_id: null,
  created_at: AT,
  updated_at: AT,
  revisions: [revision()],
  comments: { open: 0, resolved: 0 },
  ...overrides,
});

export const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: id('cmt', 1),
  project_id: PROJECT_ID,
  revision_id: REVISION_ID,
  anchor: { kind: 'file' },
  body_md: 'Tighten this.',
  author: 'operator',
  state: 'open',
  revision_task_id: null,
  addressed_in_revision_id: null,
  created_at: AT,
  resolved_at: null,
  updated_at: null,
  ...overrides,
});
