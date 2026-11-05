export interface SseEvent {
  /** The channel. 'message' when the frame names none. */
  event: string;
  data: string;
  id?: string;
}
/** A frame beyond this has lost its terminator. It is dropped rather than held in memory. */
const MAX_BUFFER = 1024 * 1024;

/** Incremental server-sent event parser, per the WHATWG format. Feed it decoded text in any chunks. */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  let carriageReturn = false;
  const line = (text: string) => {
    if (text === '') {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n'), ...(id !== undefined ? { id } : {}) });
      event = '';
      data = [];
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? '' : text.slice(text[colon + 1] === ' ' ? colon + 2 : colon + 1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
  };
  return (chunk: string) => {
    // A CRLF can straddle two chunks.
    if (carriageReturn && chunk.startsWith('\n')) chunk = chunk.slice(1);
    carriageReturn = chunk.endsWith('\r');
    buffer += chunk;
    let start = 0;
    for (const match of buffer.matchAll(/\r\n|\n|\r/g)) {
      line(buffer.slice(start, match.index));
      start = match.index + match[0].length;
    }
    buffer = buffer.slice(start);
    if (buffer.length > MAX_BUFFER) {
      buffer = '';
      event = '';
      data = [];
    }
  };
}
