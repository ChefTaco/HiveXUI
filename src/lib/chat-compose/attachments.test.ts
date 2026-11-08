import { expect, it, vi } from "vitest";
import {
  attachmentDrafts,
  clipboardAttachments,
  ChatAttachmentUploads,
  type AttachmentDrafts,
} from "./attachments";
const file = (name = "example.txt") =>
  new File(["synthetic attachment"], name, {
    type: "text/plain",
    lastModified: 7,
  });
const append = (
  state: AttachmentDrafts,
  files: File[],
  key = "channel:thread",
  blocked = false,
) => attachmentDrafts(state, { type: "append", key, files, blocked });

it("appends by File identity and rejects an oversized batch atomically while retaining prior selection", () => {
  const original = file(),
    sameMetadata = file();
  let state = append({}, [original]);
  state = append(state, [original, sameMetadata]);
  expect(state["channel:thread"]!.files).toEqual([original, sameMetadata]);
  state = append(
    state,
    Array.from({ length: 7 }, (_, index) => file("other-" + index)),
  );
  const previous = state["channel:thread"]!.files;
  state = append(state, [file("ten"), file("eleven")]);
  expect(state["channel:thread"]!.files).toBe(previous);
  expect(state["channel:thread"]!.files).toHaveLength(9);
  expect(state["channel:thread"]!.error).toMatch(/up to 10/);
  state = append(state, [file("ten")]);
  expect(state["channel:thread"]!.files).toHaveLength(10);
  expect(state["channel:thread"]!.error).toBe("");
});

it("does not edit pending files while busy and keeps other conversation drafts independent", () => {
  const first = file(),
    second = file();
  let state = append(append({}, [first]), [second], "another:thread");
  expect(append(state, [file()], "channel:thread", true)).toBe(state);
  expect(
    attachmentDrafts(state, {
      type: "remove",
      key: "channel:thread",
      file: first,
      blocked: true,
    }),
  ).toBe(state);
  state = attachmentDrafts(state, {
    type: "remove",
    key: "channel:thread",
    file: first,
    blocked: false,
  });
  expect(state["channel:thread"]!.files).toEqual([]);
  expect(state["another:thread"]!.files).toEqual([second]);
  state = attachmentDrafts(state, { type: "clear", key: "channel:thread" });
  expect(state["another:thread"]!.files).toEqual([second]);
});

it("accepts clipboard file lists or image items without swallowing ordinary text or null items", () => {
  const image = new File(["synthetic image"], "clipboard.png", {
    type: "image/png",
  });
  const data = (files: File[], items: unknown[]) =>
    ({ files, items }) as unknown as Pick<DataTransfer, "files" | "items">;
  expect(
    clipboardAttachments(
      data([image], [{ kind: "file", getAsFile: () => image }]),
    ),
  ).toEqual([image]);
  expect(
    clipboardAttachments(
      data(
        [],
        [
          { kind: "string" },
          { kind: "file", getAsFile: () => null },
          { kind: "file", getAsFile: () => image },
        ],
      ),
    ),
  ).toEqual([image]);
  expect(clipboardAttachments(data([], [{ kind: "string" }]))).toEqual([]);
});

it("retains each completed upload after failure and reuses it after adding, removing or reordering files", async () => {
  const cache = new ChatAttachmentUploads(),
    first = file(),
    second = file("second.txt"),
    third = file("third.txt");
  const initial = vi.fn(async (value: File) => {
    if (value === second) throw new Error("upload interrupted");
    return "first-upload";
  });
  await expect(
    cache.resolve("channel:thread", [first, second], initial),
  ).rejects.toThrow("upload interrupted");
  expect(initial).toHaveBeenCalledTimes(2);
  const retry = vi.fn(async (value: File) =>
    value === second ? "second-upload" : "third-upload",
  );
  expect(
    await cache.resolve("channel:thread", [third, first, second], retry),
  ).toEqual(["third-upload", "first-upload", "second-upload"]);
  expect(retry.mock.calls.map(([value]) => value)).toEqual([third, second]);
  const noUpload = vi.fn(async () => {
    throw new Error("unexpected duplicate upload");
  });
  expect(
    await cache.resolve("channel:thread", [second, first], noUpload),
  ).toEqual(["second-upload", "first-upload"]);
  expect(noUpload).not.toHaveBeenCalled();
});

it("does not reuse filenames across identities or conversations and clears only a confirmed post's cache", async () => {
  const cache = new ChatAttachmentUploads(),
    first = file(),
    distinct = file();
  const upload = vi.fn(async () => "file-" + upload.mock.calls.length);
  await cache.resolve("channel:thread", [first], upload);
  await cache.resolve("channel:thread", [distinct], upload);
  await cache.resolve("another:thread", [first], upload);
  expect(upload).toHaveBeenCalledTimes(3);
  cache.clear("channel:thread");
  await cache.resolve("another:thread", [first], upload);
  expect(upload).toHaveBeenCalledTimes(3);
  await cache.resolve("channel:thread", [first], upload);
  expect(upload).toHaveBeenCalledTimes(4);
});

it("never retries an upload automatically or caches malformed successful response IDs", async () => {
  const cache = new ChatAttachmentUploads(),
    selected = file();
  const invalid = vi.fn(async () => undefined as unknown as string);
  await expect(
    cache.resolve("channel:thread", [selected], invalid),
  ).rejects.toThrow("invalid file reference");
  expect(invalid).toHaveBeenCalledOnce();
  const valid = vi.fn(async () => "valid-file");
  expect(await cache.resolve("channel:thread", [selected], valid)).toEqual([
    "valid-file",
  ]);
  expect(valid).toHaveBeenCalledOnce();
});
