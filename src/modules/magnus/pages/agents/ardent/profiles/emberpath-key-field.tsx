// The Emberpath client key an agent on an Emberpath alias needs. Write-only: the field is a password
// field the browser does not fill or remember, its value is never logged, and each caller drops it as
// soon as the request that carries it is sent.
import { ExternalLink } from 'lucide-react';
import { Field, TextInput } from '@ui';
import { linkTo } from '../../../../../../lib/routes';
import { productInstalled } from '../../../../../../lib/runtime';
import { emberpathIssueKeyName } from './new-agent-logic';

export const EMBERPATH_KEY_HINT =
  'Issue a client key in Emberpath → API Keys, ideally limited to this alias with the models:read and inference:write scopes. Magnus checks it with Emberpath and writes it only to this agent; it is never stored or shown again.';

/** Emberpath's API keys page with its Issue key drawer open, suggesting a name for this agent's key. */
export const emberpathIssueKeyHref = (profileId: string): string => linkTo('emberpath', 'keys', { issue: emberpathIssueKeyName(profileId) });

export function EmberpathKeyField({ value, onChange, error, profileId, label = 'Emberpath client key' }: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  /** Names the key the Issue key link suggests. */
  profileId: string;
  label?: string;
}) {
  return (
    <div className="grid gap-1">
      <Field label={label} hint={EMBERPATH_KEY_HINT}>
        <TextInput type="password" value={value} required maxLength={512} autoComplete="off" spellCheck={false} autoCapitalize="off" autoCorrect="off"
          aria-invalid={!!error} data-lpignore="true" data-1p-ignore="true" onChange={(next) => onChange(next.trim())} />
        {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
      </Field>
      {productInstalled('emberpath') ? (
        <a href={emberpathIssueKeyHref(profileId)} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-xs">
          <ExternalLink className="size-3" aria-hidden="true" /> Issue a key in Emberpath (opens in a new tab)
        </a>
      ) : null}
    </div>
  );
}
