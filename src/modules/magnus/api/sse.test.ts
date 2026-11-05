import { describe, expect, it } from 'vitest';
import { createSseParser, type SseEvent } from './sse';

const parse = (...chunks: string[]) => {
  const events: SseEvent[] = [];
  const feed = createSseParser((event) => events.push(event));
  chunks.forEach(feed);
  return events;
};

describe('server-sent event parsing', () => {
  it('reads named events and the default channel', () => {
    expect(parse('event: log\ndata: {"a":1}\n\ndata: x\n\n')).toEqual([{ event: 'log', data: '{"a":1}' }, { event: 'message', data: 'x' }]);
  });
  it('joins data lines and keeps the id', () => {
    expect(parse('id: 7\ndata: one\ndata: two\n\n')).toEqual([{ event: 'message', data: 'one\ntwo', id: '7' }]);
  });
  it('accepts a frame split at any point, including inside a CRLF', () => {
    expect(parse('eve', 'nt: a\r', '\ndata', ': b\r\n\r', '\n')).toEqual([{ event: 'a', data: 'b' }]);
  });
  it('ignores comments, keep-alives and unknown fields, and holds an incomplete frame back', () => {
    expect(parse(': ping\n\nretry: 5\nfoo: bar\n\n')).toEqual([]);
    expect(parse('data: incomplete\n')).toEqual([]);
  });
  it('drops a runaway frame instead of holding it in memory', () => {
    const events: SseEvent[] = [];
    const feed = createSseParser((event) => events.push(event));
    feed('data: ' + 'x'.repeat(1024 * 1024 + 1));
    feed('\n\ndata: ok\n\n');
    expect(events).toEqual([{ event: 'message', data: 'ok' }]);
  });
});
