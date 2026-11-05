import { describe, expect, it } from 'vitest';
import { webhookEndpointSchema } from './schemas';
import { createBody, deliveryTone, eventsLabel, pageCount, parseEvents, prettyPayload, toggled, typeOptions, updateBody, type WebhookFormState } from './webhook-model';

const form: WebhookFormState = { name: ' Hook ', url: '', type: 'generic', secret: '', clearSecret: false, events: ['node.offline'], headers: [], headersTouched: false, retries: 3, timeoutMs: 10000 };

describe('webhook events', () => {
  it('reads the JSON column, tolerating a damaged one', () => {
    expect(parseEvents('["a","b"]')).toEqual(['a', 'b']);
    expect(parseEvents('nope')).toEqual([]);
    expect(parseEvents('{"a":1}')).toEqual([]);
    expect(eventsLabel('[]')).toBe('All events');
    expect(eventsLabel('["a","b"]')).toBe('a, b');
  });
  it('toggles one event', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('a webhook update', () => {
  it('leaves write-only values alone unless the operator changed them', () => {
    const body = updateBody(form);
    expect(body).toEqual({ name: 'Hook', type: 'generic', events: ['node.offline'], retries: 3, timeoutMs: 10000 });
    expect(body).not.toHaveProperty('url');
    expect(body).not.toHaveProperty('secret');
    expect(body).not.toHaveProperty('headers');
  });
  it('sends a new URL, secret and headers', () => {
    expect(updateBody({ ...form, url: ' https://a.example/x ', secret: 's', headersTouched: true, headers: [{ key: ' X-A ', value: '1' }, { key: ' ', value: 'dropped' }] })).toMatchObject({ url: 'https://a.example/x', secret: 's', headers: { 'X-A': '1' } });
  });
  it('clears a secret with null, and clears headers with an empty object', () => {
    expect(updateBody({ ...form, clearSecret: true, secret: 'ignored', headersTouched: true })).toMatchObject({ secret: null, headers: {} });
  });
});

describe('a new webhook', () => {
  it('always sends URL and headers, and a secret only if set', () => {
    expect(createBody({ ...form, url: 'https://a.example/x' })).toEqual({ name: 'Hook', url: 'https://a.example/x', type: 'generic', events: ['node.offline'], headers: {}, retries: 3, timeoutMs: 10000 });
    expect(createBody({ ...form, url: 'u', secret: 's' })).toHaveProperty('secret', 's');
  });
});

describe('webhook display', () => {
  it('keeps a stored type it does not know as an option', () => {
    expect(typeOptions('slack').map((option) => option.value)).toEqual(['generic', 'slack', 'discord', 'mattermost']);
    expect(typeOptions('legacy').map((option) => option.value)).toContain('legacy');
  });
  it('formats a payload, and shows a damaged one as it is', () => {
    expect(prettyPayload('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyPayload('raw')).toBe('raw');
  });
  it('colors a delivery by its status, and counts pages', () => {
    expect(deliveryTone('success')).toBe('success');
    expect(deliveryTone('failed')).toBe('danger');
    expect(deliveryTone('pending')).toBe('warning');
    expect(pageCount(41)).toBe(3);
  });
  it('strips values the API must not return, if it ever did', () => {
    const parsed = webhookEndpointSchema.parse({ id: 'a', name: 'n', url: 'https://a.example', type: 'generic', secretConfigured: true, events: '[]', headersConfigured: false, active: true, retries: 3, timeoutMs: 1000, createdBy: null, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', secret: 'leak', headers: 'leak' });
    expect(parsed).not.toHaveProperty('secret');
    expect(parsed).not.toHaveProperty('headers');
  });
});
