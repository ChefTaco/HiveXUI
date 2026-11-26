// The real-stack gate's reporter (e2e/studio/support/required-reporter.ts): with STUDIO_E2E_REQUIRED=1
// any skip fails the run, while a scenario declared with test.fixme is listed but does not.
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RequiredReporter from '../e2e/studio/support/required-reporter';

const testCase = (title: string, annotations: Array<{ type: string; description?: string }>) =>
  ({ titlePath: () => ['', 'chromium', 'spec.ts', title], annotations }) as unknown as TestCase;
const skipped = { status: 'skipped' } as TestResult;
const passed = { status: 'passed' } as FullResult;

describe('required reporter', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('fails a required run on a skip and names it', async () => {
    vi.stubEnv('STUDIO_E2E_REQUIRED', '1');
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const reporter = new RequiredReporter();
    reporter.onTestEnd(testCase('3. transfer recovery', [{ type: 'skip', description: 'no large file' }]), skipped);
    expect(await reporter.onEnd(passed)).toEqual({ status: 'failed' });
    expect(write.mock.calls.join('')).toContain('spec.ts › 3. transfer recovery (no large file)');
  });

  it('lists a fixme scenario without failing the run', async () => {
    vi.stubEnv('STUDIO_E2E_REQUIRED', '1');
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const reporter = new RequiredReporter();
    reporter.onTestEnd(testCase('2. interrupted execution', [{ type: 'fixme', description: 'needs a fault-injection hook' }]), skipped);
    expect(await reporter.onEnd(passed)).toBeUndefined();
    expect(write.mock.calls.join('')).toContain('marked fixme, not implemented yet');
    expect(write.mock.calls.join('')).toContain('2. interrupted execution (needs a fault-injection hook)');
  });

  it('counts a test skipped before its fixme as skipped', async () => {
    vi.stubEnv('STUDIO_E2E_REQUIRED', '1');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const reporter = new RequiredReporter();
    reporter.onTestEnd(testCase('2. interrupted execution', [{ type: 'skip', description: 'agents on Ardent before 3.2.0' }, { type: 'fixme' }]), skipped);
    expect(await reporter.onEnd(passed)).toEqual({ status: 'failed' });
  });

  it('leaves a run that is not required alone', async () => {
    vi.stubEnv('STUDIO_E2E_REQUIRED', '');
    const reporter = new RequiredReporter();
    reporter.onTestEnd(testCase('any', [{ type: 'skip' }]), skipped);
    expect(await reporter.onEnd(passed)).toBeUndefined();
  });
});
