// With STUDIO_E2E_REQUIRED=1 a skipped spec fails the run: a gate that skips proves nothing. Specs
// skip for a missing stack, a dependency an earlier step did not produce, or data the fixtures did
// not yield; each of those is a failure when the stack is supposed to be there.
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export default class RequiredReporter implements Reporter {
  private readonly skipped: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'skipped') return;
    const reason = test.annotations.find((annotation) => annotation.type === 'skip')?.description;
    this.skipped.push(`${test.titlePath().filter(Boolean).join(' › ')}${reason ? ` (${reason})` : ''}`);
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    if (process.env.STUDIO_E2E_REQUIRED !== '1' || this.skipped.length === 0) return undefined;
    process.stderr.write(`[studio-e2e] STUDIO_E2E_REQUIRED=1 and ${this.skipped.length} spec(s) skipped:\n${this.skipped.map((line) => `  - ${line}`).join('\n')}\n`);
    return { status: result.status === 'passed' ? 'failed' : result.status };
  }

  printsToStdio(): boolean {
    return false;
  }
}
