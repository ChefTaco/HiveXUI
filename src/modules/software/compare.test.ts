import { describe, expect, it } from 'vitest';
import { registryInventorySchema } from '@contracts/hive-registry/inventory';
import { attentionCount, compareComponents, compareMagnus, compareRelease, imageDigest, shortDigest, summarizeAgents } from './compare';
import { systemInstallationSchema as magnusInstallationSchema } from '@contracts/magnus/browser';
import { IMAGES, MANIFEST_3127, fleet, inventory3129, nativeMagnus } from './test-fixtures';

const byId = (rows: ReturnType<typeof compareComponents>) => Object.fromEntries(rows.map((row) => [row.id, row]));

describe('comparing pins with what the hosts report', () => {
  it('fixtures are valid contract answers', () => {
    expect(registryInventorySchema.safeParse(inventory3129()).success).toBe(true);
    expect(magnusInstallationSchema.safeParse(nativeMagnus()).success).toBe(true);
  });

  it('matches every component of a clean 3.12.9 host, and leaves the external Magnus to its own report', () => {
    const rows = byId(compareComponents(inventory3129()));
    expect(rows.oathweave!.verdict).toBe('matches');
    expect(rows.hivexui!.verdict).toBe('matches');
    // A datastore without a health check reports an empty health and still matches.
    expect(rows['cindertrace-postgres']!.verdict).toBe('matches');
    expect(rows.magnus!.verdict).toBe('external');
    expect(attentionCount(Object.values(rows))).toBe(0);
  });

  it('flags a host still running the previous release image, by digest, whatever the version says', () => {
    const rows = byId(compareComponents(inventory3129({ emberpathImage: IMAGES.emberpath3127 })));
    expect(rows.emberpath!.verdict).toBe('differs');
    expect(rows.emberpath!.reason).toBe('control runs sha256:d57842aa8209, not the pinned sha256:9b1667a50a37.');
    expect(rows.emberpath!.reported?.runningDigest).toBe(imageDigest(IMAGES.emberpath3127));
  });

  it('flags a container whose local image is not the one its pinned reference names', () => {
    const inventory = inventory3129();
    inventory.hosts[0]!.services[0]!.imageMatches = false;
    expect(byId(compareComponents(inventory)).oathweave!.verdict).toBe('differs');
  });

  it('separates stopped, unhealthy and missing containers from differences', () => {
    const inventory = inventory3129();
    inventory.hosts[0]!.services[0]!.state = 'exited';
    inventory.hosts[0]!.services[1]!.health = 'unhealthy';
    inventory.hosts[0]!.services[2] = { ...inventory.hosts[0]!.services[2]!, state: 'missing', runningImage: null };
    const rows = byId(compareComponents(inventory));
    expect(rows.oathweave!.verdict).toBe('not-running');
    expect(rows.emberpath!.verdict).toBe('not-running');
    expect(rows.hivexui!.verdict).toBe('not-running');
  });

  it('says when no host reported a component yet', () => {
    const inventory = inventory3129();
    inventory.hosts = [];
    expect(byId(compareComponents(inventory)).oathweave!.verdict).toBe('not-reported');
    expect(compareRelease(inventory)).toEqual([]);
  });

  it('compares each host receipt with the recorded release, version and manifest digest', () => {
    expect(compareRelease(inventory3129())[0]!.verdict).toBe('matches');
    expect(compareRelease(inventory3129({ receipt: { version: '3.12.7', digest: MANIFEST_3127 } }))[0]!.verdict).toBe('differs');
    // Same label, different manifest: a re-signed or tampered release is still a difference.
    expect(compareRelease(inventory3129({ receipt: { version: '3.12.9', digest: MANIFEST_3127 } }))[0]!.verdict).toBe('differs');
  });
});

describe('the Magnus report', () => {
  it('flags the 3.12.9 case: the right version, but npm resolved effect 3.20.0 where the signed lock has 3.22.1', () => {
    const row = compareMagnus(nativeMagnus(), '3.1.5');
    expect(row.versionVerdict).toBe('matches');
    expect(row.layout).toBe('package');
    expect(row.resolutionVerdict).toBe('differs');
    expect(row.resolution.differences).toEqual([{ name: 'effect', path: 'node_modules/@prisma/config/node_modules/effect', expected: '3.22.1', actual: '3.20.0' }]);
  });
  it('matches once the install resolves the signed lock', () => {
    expect(compareMagnus(nativeMagnus([]), '3.1.5').resolutionVerdict).toBe('matches');
  });
  it('cannot check a package that ships no lock, and says a version off the pin', () => {
    const report = nativeMagnus([]);
    report.resolution.reference = 'none';
    const row = compareMagnus({ ...report, magnus: { ...report.magnus, version: '3.1.4' } }, '3.1.5');
    expect(row.resolutionVerdict).toBe('unchecked');
    expect(row.versionVerdict).toBe('differs');
    expect(compareMagnus(report, null).versionVerdict).toBe('unpinned');
  });
});

describe('host agents', () => {
  it('counts nodes on the pinned agent and lists the rest, including silent ones', () => {
    const summary = summarizeAgents(fleet(16, { 'node-zz': '3.1.4', 'node-aa': null }), '3.1.5');
    expect(summary.onPin).toBe(16);
    expect(summary.offPin).toEqual([{ name: 'node-aa', version: null }, { name: 'node-zz', version: '3.1.4' }]);
  });
});

describe('digests', () => {
  it('reads the digest from a pinned reference and shortens it for tables', () => {
    expect(imageDigest(IMAGES.hivexui)).toBe('sha256:977c44f7c9e38bdd4a8e20427d92d8cbddf89704ee1e615ad5e8006470cab2eb');
    expect(imageDigest('ghcr.io/cheftaco/hivexui:latest')).toBeNull();
    expect(shortDigest('sha256:977c44f7c9e38bdd4a8e')).toBe('sha256:977c44f7c9e3');
    expect(shortDigest(null)).toBe('—');
  });
});

describe('what the Registry records beyond running products', () => {
  it('leaves out products the release offers but this installation did not select', () => {
    const inventory = inventory3129();
    inventory.components.push({ ...inventory.components[0]!, id: 'chattermost', displayName: 'ChatterMost', status: 'not-installed', inventoryHost: null });
    expect(compareComponents(inventory).map((row) => row.id)).not.toContain('chattermost');
  });
  it('shows an operator-added product as external, with what the operator recorded', () => {
    const inventory = inventory3129();
    inventory.components.push({ id: 'legacy-tool', displayName: 'Legacy tool', kind: 'application', source: 'external', status: 'installed', inventoryHost: null, pinned: null, recorded: { version: '1.2.0', imageDigest: null } });
    const row = compareComponents(inventory).find((item) => item.id === 'legacy-tool')!;
    expect(row.verdict).toBe('external');
    expect(row.reason).toBe('Added by an operator as 1.2.0; no signed release pins it.');
  });
  it('does not call a host it could not reach a match or a difference', () => {
    const inventory = inventory3129();
    inventory.hosts[0]!.unreachable = true;
    expect(byId(compareComponents(inventory)).oathweave!.verdict).toBe('not-reported');
    expect(compareRelease(inventory)[0]!.verdict).toBe('not-reported');
  });
  it('compares only hosts that run this installation', () => {
    const inventory = inventory3129();
    inventory.hosts.push({ ...inventory.hosts[0]!, host: 'spare', active: false, receipt: null, services: [] });
    expect(compareRelease(inventory).map((row) => row.host)).toEqual(['control']);
  });
});
