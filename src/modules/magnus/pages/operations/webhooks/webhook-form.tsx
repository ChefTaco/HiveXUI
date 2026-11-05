import { useState, type FormEvent } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { Button, Field, IconButton, Select, TextInput } from '@ui';
import { cn } from '@lib/cn';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useRouter } from '../../../navigation';
import { FormError } from '../shared/parts';
import { webhookResponseSchema, type WebhookEndpoint } from './schemas';
import { createBody, EVENT_OPTIONS, parseEvents, toggled, typeOptions, updateBody } from './webhook-model';

export function WebhookForm({ endpoint }: { endpoint?: WebhookEndpoint }) {
  const router = useRouter();
  const isEdit = !!endpoint;
  const [name, setName] = useState(endpoint?.name ?? '');
  const [url, setUrl] = useState('');
  const [type, setType] = useState(endpoint?.type ?? 'generic');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [events, setEvents] = useState<string[]>(endpoint ? parseEvents(endpoint.events) : []);
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [headersTouched, setHeadersTouched] = useState(false);
  const [retries, setRetries] = useState(endpoint?.retries ?? 3);
  const [timeoutMs, setTimeoutMs] = useState(endpoint?.timeoutMs ?? 10000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changeHeaders = (next: Array<{ key: string; value: string }>) => {
    setHeaders(next);
    setHeadersTouched(true);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || (!isEdit && !url.trim())) return;
    setSaving(true);
    setError('');
    const state = { name, url, type, secret, clearSecret, events, headers, headersTouched, retries, timeoutMs };
    try {
      if (endpoint) await magnus.patch(`/webhooks/${segment(endpoint.id)}`, webhookResponseSchema, { body: updateBody(state) });
      else await magnus.post('/webhooks', webhookResponseSchema, { body: createBody(state) });
      router.push('/webhooks');
    } catch (caught) {
      setError(errorMessage(caught, 'The webhook could not be saved. Check the URL and try again.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="grid max-w-2xl gap-5">
      <FormError message={error} />
      <Field label="Name"><TextInput value={name} onChange={setName} required placeholder="My webhook" /></Field>
      <Field label="URL" hint={endpoint ? `Leave blank to keep the current target on ${endpoint.url}.` : 'An HTTPS address. The server accepts only origins on its allowlist.'}>
        <TextInput type="url" className="font-mono" value={url} onChange={setUrl} required={!isEdit} placeholder="https://example.com/webhook" />
      </Field>
      <Field label="Type"><Select value={type} onChange={setType} options={typeOptions(type)} /></Field>
      <div className="grid gap-2">
        <Field label="Secret" hint={isEdit ? `${endpoint?.secretConfigured ? 'Configured. ' : ''}Leave empty to keep the current one.` : 'Optional. An HMAC signing secret.'}>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(value) => {
              setSecret(value);
              setClearSecret(false);
            }}
            placeholder={isEdit ? '••••••••' : 'HMAC signing secret'}
          />
        </Field>
        {endpoint?.secretConfigured ? (
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-danger"
              aria-pressed={clearSecret}
              onClick={() => {
                setSecret('');
                setClearSecret(true);
              }}
            >
              {clearSecret ? 'Signing secret will be cleared' : 'Clear saved signing secret'}
            </Button>
          </div>
        ) : null}
      </div>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="field-label p-0">Events (empty means all events)</legend>
        <div className="flex flex-wrap gap-2">
          {EVENT_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={events.includes(option)}
              onClick={() => setEvents(toggled(events, option))}
              className={cn('glow-hover cursor-pointer rounded-pill border px-2.5 py-1 font-mono text-xs transition-colors duration-[var(--duration-base)]', events.includes(option) ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-text-muted hover:text-text')}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="field-label p-0">Custom headers{endpoint?.headersConfigured && !headersTouched ? ' (configured; values are write-only)' : ''}</legend>
        {headers.map((header, index) => (
          <div key={index} className="flex items-center gap-2">
            <TextInput className="min-w-0 flex-1" aria-label={`Header ${index + 1} name`} placeholder="Header name" value={header.key} onChange={(key) => changeHeaders(headers.map((item, position) => (position === index ? { key, value: item.value } : item)))} />
            <TextInput className="min-w-0 flex-1" aria-label={`Header ${index + 1} value`} placeholder="Value" value={header.value} onChange={(value) => changeHeaders(headers.map((item, position) => (position === index ? { key: item.key, value } : item)))} />
            <IconButton type="button" label={`Remove header ${index + 1}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={() => changeHeaders(headers.filter((_, position) => position !== index))} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" icon={<Plus className="size-4" />} onClick={() => changeHeaders([...headers, { key: '', value: '' }])}>Add header</Button>
          {endpoint?.headersConfigured ? <Button type="button" size="sm" variant="ghost" className="text-danger" onClick={() => changeHeaders([])}>{headersTouched && headers.length === 0 ? 'Saved headers will be cleared' : 'Clear saved headers'}</Button> : null}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Retries"><input type="number" min={0} max={10} value={retries} onChange={(event) => setRetries(Number(event.target.value))} /></Field>
        <Field label="Timeout (ms)"><input type="number" min={1000} max={60000} step={1000} value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!name.trim() || (!isEdit && !url.trim())}>{isEdit ? 'Update' : 'Create'}</Button>
        <Button type="button" variant="ghost" icon={<X className="size-4" />} onClick={() => router.push('/webhooks')}>Cancel</Button>
      </div>
    </form>
  );
}
