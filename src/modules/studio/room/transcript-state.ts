// One conversation's transcript: the stored messages, kept current by message events, plus the live
// text of replies still streaming. Pure, so the stream rules are tested without a page. The stored
// message is authoritative: live text is only a view of a reply until its final message arrives.
import type { Message } from '../api/endpoints';
import type { MessageDelta } from '../api/stream';

export interface LiveText {
  /** The step the text belongs to. A new step replaces the text of the one before it. */
  step: number;
  text: string;
}

export interface TranscriptState {
  conversationId: string | null;
  status: 'loading' | 'ready' | 'error';
  /** Sorted by seq. */
  messages: readonly Message[];
  /** Live text by message id, for replies whose state is still `streaming`. */
  live: Readonly<Record<string, LiveText>>;
  /** Replies that finished while this transcript was open, newest last, for one announcement each. */
  finished: readonly string[];
}

export type TranscriptAction =
  | { type: 'open'; conversationId: string | null }
  /** A full read of the conversation, after opening it or after the stream lost its place. */
  | { type: 'loaded'; conversationId: string; messages: readonly Message[] }
  | { type: 'failed'; conversationId: string }
  | { type: 'message'; message: Message }
  | { type: 'delta'; delta: MessageDelta }
  /** The stream skipped or reset: the copy may be missing messages, so it is read again. */
  | { type: 'reset' };

export const emptyTranscript = (conversationId: string | null = null): TranscriptState => ({ conversationId, status: conversationId ? 'loading' : 'ready', messages: [], live: {}, finished: [] });

const bySeq = (a: Message, b: Message) => a.seq - b.seq;

function withoutLive(live: Readonly<Record<string, LiveText>>, id: string): Readonly<Record<string, LiveText>> {
  if (!(id in live)) return live;
  const next = { ...live };
  delete next[id];
  return next;
}

export function reduceTranscript(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.type) {
    case 'open':
      return state.conversationId === action.conversationId ? state : emptyTranscript(action.conversationId);
    case 'loaded': {
      if (action.conversationId !== state.conversationId) return state;
      const messages = [...action.messages].sort(bySeq);
      // Live text survives a re-read only for replies that are still streaming.
      const streaming = new Set(messages.filter((message) => message.state === 'streaming').map((message) => message.id));
      const live = Object.fromEntries(Object.entries(state.live).filter(([id]) => streaming.has(id) || !messages.some((message) => message.id === id)));
      return { ...state, status: 'ready', messages, live };
    }
    case 'failed':
      return action.conversationId === state.conversationId ? { ...state, status: state.messages.length ? 'ready' : 'error' } : state;
    case 'reset':
      return state.conversationId ? { ...state, status: 'loading' } : state;
    case 'message': {
      const { message } = action;
      if (message.conversation_id !== state.conversationId) {
        const live = message.state === 'streaming' ? state.live : withoutLive(state.live, message.id);
        return live === state.live ? state : { ...state, live };
      }
      const index = state.messages.findIndex((item) => item.id === message.id);
      const before = index >= 0 ? state.messages[index] : undefined;
      // An older copy never replaces a newer one.
      if (before && before.updated_at > message.updated_at) return state;
      const messages = index >= 0 ? state.messages.map((item, at) => (at === index ? message : item)) : [...state.messages, message].sort(bySeq);
      if (message.state === 'streaming') return { ...state, messages };
      const finished = before?.state === 'streaming' ? [...state.finished, message.id].slice(-20) : state.finished;
      return { ...state, messages, live: withoutLive(state.live, message.id), finished };
    }
    case 'delta': {
      const { message_id: id, text, mode = 'append', step = 0 } = action.delta;
      const stored = state.messages.find((message) => message.id === id);
      // A reply that already has its final text takes no more live text.
      if (stored && stored.state !== 'streaming') return state;
      const current = state.live[id];
      if (current && step < current.step) return state;
      const next: LiveText = mode === 'replace' || !current || step !== current.step ? { step, text } : { step, text: current.text + text };
      return { ...state, live: { ...state.live, [id]: next } };
    }
  }
}

/** Structured or tool steps are not shown as raw JSON: the bubble says "Working…" until plain text arrives. */
export function visibleLiveText(live: LiveText | undefined): string | null {
  const text = live?.text ?? '';
  const trimmed = text.trimStart();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```json')) return null;
  return text;
}
