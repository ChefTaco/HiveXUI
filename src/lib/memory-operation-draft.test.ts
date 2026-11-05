import { expect, it, vi } from "vitest";
import { MemoryOperationDraft } from "./memory-operation-draft";
it("keeps the original durable operation after a dropped response and refuses payload replacement", () => {
  const draft = new MemoryOperationDraft();
  const newId = vi
    .fn()
    .mockReturnValueOnce("synthetic-operation-1")
    .mockReturnValueOnce("synthetic-operation-2");
  const body = {
    workspace_id: "team",
    memory_ids: ["synthetic-memory"],
    strategy: "compatibility",
  };
  expect(draft.prepare(body, newId)).toBe("synthetic-operation-1");
  // The server may have committed even when the browser sees a network error.
  expect(draft.prepare({ ...body }, newId)).toBe("synthetic-operation-1");
  expect(() =>
    draft.prepare({ ...body, workspace_id: "different-team" }, newId),
  ).toThrow(/Resolve the previous/);
  expect(newId).toHaveBeenCalledTimes(1);
  draft.acknowledge();
  expect(
    draft.prepare({ ...body, workspace_id: "different-team" }, newId),
  ).toBe("synthetic-operation-2");
});
