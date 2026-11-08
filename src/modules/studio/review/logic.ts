// Pure rules for Deliverable Review: which renderer a file gets, list filters, and what the decision
// bar allows. No React, so tests read them directly.
import type { Tone } from '@ui';
import type { Deliverable, ReviewComment, Revision } from './api';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type RendererKind = 'markdown' | 'text' | 'image' | 'pdf' | 'docx' | 'fallback';

/** The PreviewRenderer for a MIME type. SVG is an image; its source also takes text comments. */
export function rendererKind(mime: string): RendererKind {
  const type = mime.split(';', 1)[0]!.trim().toLowerCase();
  if (type === 'text/markdown') return 'markdown';
  if (type === 'text/plain' || type === 'text/csv' || type === 'application/json') return 'text';
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(type)) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type === DOCX_MIME) return 'docx';
  return 'fallback';
}
/** Files whose bytes are decoded as UTF-8 text for text anchors and diffs. */
export const isTextual = (mime: string): boolean => ['markdown', 'text'].includes(rendererKind(mime)) || mime.startsWith('image/svg+xml');
/** The largest text the browser decodes and diffs. Larger files still render through download. */
export const TEXT_LIMIT = 8 * 1024 * 1024;

export const STATUS: Record<Revision['review_status'], { label: string; tone: Tone }> = {
  unreviewed: { label: 'New', tone: 'info' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  superseded: { label: 'Superseded', tone: 'neutral' },
};

export const latestRevision = (deliverable: Deliverable): Revision | undefined => deliverable.revisions.reduce<Revision | undefined>((latest, item) => (!latest || item.revision > latest.revision ? item : latest), undefined);
export const finalRevision = (deliverable: Deliverable): Revision | undefined => deliverable.revisions.find((item) => item.id === deliverable.final_revision_id);
const agentOf = (revision: Revision): string | null => {
  const ref = revision.ardent?.agent_ref;
  return typeof ref === 'string' ? ref : null;
};

export interface ReviewFilter {
  status: Revision['review_status'] | 'final' | '';
  producer: string;
  kind: string;
  /** Only deliverables this agent produced: its roles, or revisions its Ardent tasks registered. */
  agent?: { ref: string; roles: readonly string[] } | undefined;
}

export function filterDeliverables(deliverables: readonly Deliverable[], filter: ReviewFilter): Deliverable[] {
  return deliverables.filter((deliverable) => {
    const latest = latestRevision(deliverable);
    if (filter.agent && !(deliverable.producer_role && filter.agent.roles.includes(deliverable.producer_role)) && !deliverable.revisions.some((revision) => agentOf(revision) === filter.agent!.ref)) return false;
    if (filter.producer && deliverable.producer_role !== filter.producer) return false;
    if (filter.kind && deliverable.kind !== filter.kind) return false;
    if (filter.status === 'final') return Boolean(deliverable.final_revision_id);
    if (filter.status && latest?.review_status !== filter.status) return false;
    return true;
  });
}

export interface Rule {
  enabled: boolean;
  /** Why it is off, shown beside the control. */
  reason?: string;
}
export interface DecisionRules {
  accept: Rule;
  changes: Rule & { needsNote: boolean };
  reject: Rule;
  final: Rule & { isFinal: boolean };
}

/** What the decision bar allows for one revision. The service enforces the same rules. */
export function decisionRules({ deliverable, revision, comments, readOnly }: { deliverable: Deliverable; revision: Revision; comments: readonly ReviewComment[]; readOnly: boolean }): DecisionRules {
  const open = comments.some((comment) => comment.revision_id === revision.id && comment.state === 'open');
  const isFinal = deliverable.final_revision_id === revision.id;
  const status = revision.review_status;
  if (readOnly) {
    const reason = 'The project is archived';
    return { accept: { enabled: false, reason }, changes: { enabled: false, reason, needsNote: !open }, reject: { enabled: false, reason }, final: { enabled: false, reason, isFinal } };
  }
  return {
    accept: status === 'accepted' ? { enabled: false, reason: 'Already accepted' } : { enabled: true },
    changes: status === 'changes_requested' ? { enabled: false, reason: 'Changes already requested', needsNote: !open } : { enabled: true, needsNote: !open },
    reject: status === 'rejected' ? { enabled: false, reason: 'Already rejected' } : { enabled: true },
    final: isFinal ? { enabled: false, reason: 'This is the final revision', isFinal } : status === 'rejected' ? { enabled: false, reason: 'A rejected revision cannot be final', isFinal } : { enabled: true, isFinal },
  };
}

/** Export needs at least one deliverable with a final revision. */
export const canExport = (deliverables: readonly Deliverable[]): Rule =>
  deliverables.some((deliverable) => deliverable.final_revision_id) ? { enabled: true } : { enabled: false, reason: 'Mark a final revision first' };

export const shortMime = (mime: string, name?: string): string => {
  const extension = name?.includes('.') ? name.split('.').pop()!.toLowerCase() : null;
  if (extension && extension.length <= 5) return extension;
  const map: Record<string, string> = { 'text/markdown': 'md', 'text/plain': 'txt', 'application/pdf': 'pdf', 'image/svg+xml': 'svg', [DOCX_MIME]: 'docx' };
  return map[mime] ?? mime.split('/').pop() ?? mime;
};

/** The file name the producer registered, from its Ardent manifest. */
export function revisionName(revision: Revision, fallback: string): string {
  const manifest = revision.ardent?.manifest;
  const name = manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>).name : undefined;
  return typeof name === 'string' && name ? name : fallback;
}
