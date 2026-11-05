/** Keep a durable request identity after an uncertain network outcome. */
export class MemoryOperationDraft {
  private pending: {
    fingerprint: string;
    id: string;
    workspace: string;
  } | null = null;
  prepare(body: { workspace_id: string }, newId: () => string): string {
    const fingerprint = JSON.stringify(body);
    if (this.pending && this.pending.fingerprint !== fingerprint)
      throw new Error(
        "Resolve the previous consolidation operation before changing its request. Inspect its receipt or retry the same inputs.",
      );
    this.pending ??= { fingerprint, id: newId(), workspace: body.workspace_id };
    return this.pending.id;
  }
  get id(): string | undefined {
    return this.pending?.id;
  }
  get workspace(): string | undefined {
    return this.pending?.workspace;
  }
  acknowledge(): void {
    this.pending = null;
  }
}
