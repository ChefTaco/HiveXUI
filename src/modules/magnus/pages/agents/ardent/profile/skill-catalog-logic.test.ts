import { describe, expect, it } from 'vitest';
import { installBlockedReason, installFailure, installOutcome, matchCatalog, skillListKey } from './skill-catalog-logic';

const skill = (slug: string, name: string, description = '') => ({ slug, name, description });
const result = { source: 'hiveskills' as const, name: 'web-research', version: '1.2.0', sha256: 'a'.repeat(64), files: 2, changed: true, enabled: true, revision: 'b'.repeat(64), enable_error: null, activation_required: true };

describe('catalog skill installs', () => {
  it('searches slug, name and description by every word', () => {
    const catalog = [skill('web-research', 'Web research', 'Search the web carefully'), skill('hivemem', 'HiveMem', 'Durable memory'), skill('map-maker', 'Maps')];
    expect(matchCatalog(catalog, '').map((item) => item.slug)).toEqual(['web-research', 'hivemem', 'map-maker']);
    expect(matchCatalog(catalog, 'MEMORY').map((item) => item.slug)).toEqual(['hivemem']);
    expect(matchCatalog(catalog, 'web careful').map((item) => item.slug)).toEqual(['web-research']);
    expect(matchCatalog(catalog, 'web memory')).toEqual([]);
    expect(matchCatalog(catalog, '', 2)).toHaveLength(2);
  });

  it('blocks only a node agent known to be below studio level 3', () => {
    expect(installBlockedReason(null)).toBeNull();
    expect(installBlockedReason(3)).toBeNull();
    expect(installBlockedReason(2, 'node one')).toBe('Upgrade the Magnus agent on node one to install catalog skills.');
    expect(installBlockedReason(0)).toContain('this node');
  });

  it('says what was installed, enabled or left disabled', () => {
    expect(installOutcome(result)).toEqual({ tone: 'success', text: 'Installed web-research 1.2.0 and enabled. Restart the profile to activate it.' });
    expect(installOutcome({ ...result, changed: false, enabled: false, revision: null, activation_required: false })).toEqual({ tone: 'success', text: 'web-research 1.2.0 was already installed.' });
    expect(installOutcome({ ...result, enabled: false, revision: null, enable_error: 'The profile is not running; enable the skill once it is' }))
      .toEqual({ tone: 'warning', text: 'Installed web-research 1.2.0, but it is not enabled: The profile is not running; enable the skill once it is' });
  });

  it('names the upgrade when Magnus or Studio predates catalog installs', () => {
    expect(installFailure({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid Ardent action' })).toBe('This Magnus release cannot install catalog skills. Upgrade Magnus first.');
    expect(installFailure({ status: 409, code: 'MAGNUS_UPGRADE_REQUIRED', message: 'x' })).toContain('Upgrade Magnus');
    expect(installFailure({ status: 404, code: 'NOT_FOUND', message: 'No such route' })).toContain('Upgrade Ardent Project Studio');
    expect(installFailure({ status: 503, code: 'HIVESKILLS_UNCONFIGURED', message: 'x' })).toContain('MAGNUS_ARDENT_HIVESKILLS_URL');
    expect(installFailure({ status: 409, code: 'SKILL_CONFLICT', message: 'The profile has a skill named web-research that Magnus did not install' })).toContain('did not install');
    expect(installFailure(new Error(''))).toBe('The skill could not be installed');
  });

  it('keys a skill list by its skills and revision', () => {
    expect(skillListKey([{ name: 'a', enabled: true }, { name: 'b', enabled: false }], 'r1')).toBe('r1:a=1,b=0');
  });
});
