// With STUDIO_E2E_REQUIRED=1 a skipped spec fails the run: a gate that skips proves nothing. Specs
// skip for a missing stack, a dependency an earlier step did not produce, or data the fixtures did
// not yield; each of those is a failure when the stack is supposed to be there.
//
// A scenario marked `test.fixme` is different: it is declared as not written yet, in the spec, with
// the reason. It is listed on every run as not implemented but does not fail it, so one known gap
// cannot keep the gate red and hide the next real failure. A `test.skip` never gets that exemption.
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export default class RequiredReporter implements Reporter {
  private readonly skipped: string[] = [];
  private readonly pending: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'skipped') return;
    const name = test.titlePath().filter(Boolean).join(' › ');
    // Playwright adds the annotation of the call that skipped the test; an earlier test.skip wins.
    const reason = test.annotations.find((annotation) => annotation.type === 'skip' || annotation.type === 'fixme');
    const line = `${name}${reason?.description ? ` (${reason.description})` : ''}`;
    if (reason?.type === 'fixme') this.pending.push(line);
    else this.skipped.push(line);
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    if (process.env.STUDIO_E2E_REQUIRED !== '1') return undefined;
    if (this.pending.length) process.stderr.write(`[studio-e2e] ${this.pending.length} scenario(s) marked fixme, not implemented yet:\n${this.pending.map((line) => `  - ${line}`).join('\n')}\n`);
    if (this.skipped.length === 0) return undefined;
    process.stderr.write(`[studio-e2e] STUDIO_E2E_REQUIRED=1 and ${this.skipped.length} spec(s) skipped:\n${this.skipped.map((line) => `  - ${line}`).join('\n')}\n`);
    return { status: result.status === 'passed' ? 'failed' : result.status };
  }

  printsToStdio(): boolean {
    return false;
  }
}
