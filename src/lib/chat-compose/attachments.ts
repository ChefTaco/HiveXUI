export const MAX_CHAT_ATTACHMENTS = 10;
export type AttachmentDraft = { files: File[]; error: string };
export type AttachmentDrafts = Record<string, AttachmentDraft>;
export type AttachmentAction =
  | { type: "append"; key: string; files: readonly File[]; blocked: boolean }
  | { type: "remove"; key: string; file: File; blocked: boolean }
  | { type: "clear"; key: string };

/** Selection is atomic: a rejected batch never replaces or trims the old files. */
export function attachmentDrafts(
  state: AttachmentDrafts,
  action: AttachmentAction,
): AttachmentDrafts {
  if (action.type !== "clear" && action.blocked) return state;
  const previous = state[action.key] ?? { files: [], error: "" };
  if (action.type === "clear")
    return { ...state, [action.key]: { files: [], error: "" } };
  if (action.type === "remove")
    return {
      ...state,
      [action.key]: {
        files: previous.files.filter((file) => file !== action.file),
        error: "",
      },
    };
  // Browser File identity matters: distinct files can share a name and metadata.
  const selected = [...new Set([...previous.files, ...action.files])];
  return {
    ...state,
    [action.key]:
      selected.length > MAX_CHAT_ATTACHMENTS
        ? {
            files: previous.files,
            error:
              "You can attach up to 10 files. Remove a file before adding more.",
          }
        : { files: selected, error: "" },
  };
}

export function clipboardAttachments(
  data: Pick<DataTransfer, "files" | "items">,
): File[] {
  const files = Array.from(data.files);
  if (files.length) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/** Retain each successful upload through manual post retries and selection edits. */
export class ChatAttachmentUploads {
  private readonly uploads = new Map<string, WeakMap<File, string>>();

  public async resolve(
    key: string,
    files: readonly File[],
    upload: (file: File) => Promise<string>,
  ): Promise<string[]> {
    let cached = this.uploads.get(key);
    if (!cached) {
      cached = new WeakMap();
      this.uploads.set(key, cached);
    }
    const ids: string[] = [];
    for (const file of files) {
      let id = cached.get(file);
      if (!id) {
        id = await upload(file);
        if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
          throw new Error(
            "Attachment upload returned an invalid file reference",
          );
        cached.set(file, id);
      }
      ids.push(id);
    }
    return ids;
  }

  public clear(key: string): void {
    this.uploads.delete(key);
  }
}
