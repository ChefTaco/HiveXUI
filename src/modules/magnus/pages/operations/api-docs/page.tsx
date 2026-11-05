import { useState } from 'react';
import { Book, Download, FileJson } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader } from '@ui';
import { magnus } from '../../../api/client';
import { errorMessage, MagnusApiError } from '../../../api/errors';
import { FxPanel, PageItem } from '../../../effects';
import { LoadingRows } from '../../../ui/resource-state';
import { downloadText } from '../shared/parts';
import { methodTone, openApiSpecSchema, operationsOf, type OpenApiSpec } from './schemas';

/** The document is loaded by the operator, as before. See schemas.ts for where it comes from. */
export default function ApiDocsPage() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      setSpec(await magnus.get('/docs/openapi.json', openApiSpecSchema));
    } catch (caught) {
      setSpec(null);
      setError(caught);
    } finally {
      setLoading(false);
    }
  }
  const operations = spec ? operationsOf(spec) : [];
  const unavailable = error instanceof MagnusApiError && error.notFound;
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader title="API Documentation" eyebrow="Operations" icon={<Book className="size-5" />} description="OpenAPI documentation for the Fleet API" />
      </PageItem>
      {!spec && !loading ? (
        <PageItem>
          <FxPanel interactive={false} hero>
            {error ? (
              <EmptyState
                tone="warning"
                icon={<FileJson className="size-5" />}
                title={unavailable ? 'This installation does not serve the API document' : 'The API document could not be loaded'}
                message={unavailable ? 'Its ingress does not offer the OpenAPI document to the console yet.' : errorMessage(error)}
                action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
              />
            ) : (
              <EmptyState icon={<FileJson className="size-5" />} title="Load the API document to browse its endpoints" action={<Button variant="primary" onClick={() => void load()}>Load Fleet API docs</Button>} />
            )}
          </FxPanel>
        </PageItem>
      ) : null}
      {loading ? <PageItem><FxPanel interactive={false}><LoadingRows rows={8} /></FxPanel></PageItem> : null}
      {spec && !loading ? (
        <>
          <PageItem>
            <FxPanel
              hero
              interactive={false}
              title={spec.info?.title ?? 'Fleet API'}
              {...(spec.info?.version ? { description: `Version ${spec.info.version}` } : {})}
              actions={<Button size="sm" icon={<Download className="size-4" />} onClick={() => downloadText(JSON.stringify(spec, null, 2), 'magnus-openapi.json', 'application/json')}>Download JSON</Button>}
            >
              <p className="num m-0 text-sm text-text-muted">{operations.length} operations</p>
            </FxPanel>
          </PageItem>
          <PageItem>
            <FxPanel padding="none" interactive={false}>
              <ul className="m-0 list-none divide-y divide-border p-0">
                {operations.map((operation) => (
                  <li key={operation.key} className="fx-rail">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-3 hover:bg-surface-hover">
                        <Badge tone={methodTone(operation.method)} className="font-mono">{operation.method.toUpperCase()}</Badge>
                        <code className="min-w-0 break-all text-sm">{operation.path}</code>
                        {operation.summary ? <span className="ml-auto min-w-0 text-sm text-text-muted">{operation.summary}</span> : null}
                      </summary>
                      <div className="grid gap-2 border-t border-border p-3">
                        {operation.description ? <p className="m-0 text-sm text-text-muted">{operation.description}</p> : null}
                        {operation.tags.length > 0 ? <div className="flex flex-wrap gap-1">{operation.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div> : null}
                        {!operation.description && operation.tags.length === 0 ? <p className="m-0 text-sm text-text-muted">No further description.</p> : null}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </FxPanel>
          </PageItem>
        </>
      ) : null}
    </div>
  );
}
