// A revision's bytes in the browser: downloaded once per digest, checked against it, decoded as text
// where the file is text, and offered as a blob: URL for images and downloads. Never inlined.
import { useEffect, useState } from 'react';
import { fetchBlob, sha256Hex, type Revision } from './api';
import { isTextual, TEXT_LIMIT } from './logic';

export interface Content {
  blob: Blob;
  /** A blob: URL for <img>, <image> and downloads; revoked when the viewer lets go of it. */
  url: string;
  /** The bytes decoded as UTF-8, for text files up to TEXT_LIMIT. */
  text: string | null;
  /** The bytes match the revision's SHA-256. */
  verified: boolean;
}
export type ContentState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; content: Content };

export async function loadContent(revision: Pick<Revision, 'blob_sha256' | 'mime' | 'size'>, signal?: AbortSignal, fetcher = fetchBlob): Promise<Omit<Content, 'url'>> {
  const blob = await fetcher(revision.blob_sha256, revision.mime, signal);
  const verified = (await sha256Hex(blob)) === revision.blob_sha256;
  const text = isTextual(revision.mime) && blob.size <= TEXT_LIMIT ? new TextDecoder().decode(await blob.arrayBuffer()) : null;
  return { blob, text, verified };
}

/** The content of one revision, reloaded when its digest changes. */
export function useRevisionContent(revision: Pick<Revision, 'blob_sha256' | 'mime' | 'size'> | undefined, attempt = 0): ContentState {
  const [state, setState] = useState<ContentState>({ status: 'loading' });
  const sha = revision?.blob_sha256;
  const mime = revision?.mime;
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    let url: string | null = null;
    setState({ status: 'loading' });
    loadContent(revision, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(loaded.blob);
        setState({ status: 'ready', content: { ...loaded, url } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      },
    );
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
    // The digest and type name the bytes; the object around them may be a new copy of the same record.
  }, [sha, mime, attempt]);
  return state;
}
