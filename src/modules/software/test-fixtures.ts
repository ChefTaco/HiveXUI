// The suite 3.12.9 rollout as this page would have seen it, with placeholder host names. Digests
// are the public release manifests' (releases/3.12.9.json and 3.12.7.json in the Hive repository).
// Tests only.
import type { RegistryInventory } from '@contracts/hive-registry/inventory';
import type { SystemInstallation as MagnusInstallation } from '@contracts/magnus/browser';

export const MANIFEST_3129 = '227d003449ae500d6dbf5e20c2b7139c6a1af92a0e642c3a84a01a0093bd9824';
export const MANIFEST_3127 = '1e7ad239ac6c64ff246a74291e032ec1071c9da4380b4272048ea64ce58000e9';
const ref = (repository: string, hex: string) => `ghcr.io/cheftaco/${repository}@sha256:${hex}`;
export const IMAGES = {
  oathweave: ref('oathweave', 'e3ca47b71c3a9faf44c72d2721efe4926b0cc7abc679822a0afb906b1d5799e3'),
  emberpath: ref('emberpath', '9b1667a50a37bfe2cd1846acac22a28ee350959c578fc972c13e1fdf443d14f3'),
  emberpath3127: ref('emberpath', 'd57842aa8209779e3cdc2d886f47a24b0fc5fa2d04d1df052ee5573a27ab00b4'),
  hivexui: ref('hivexui', '977c44f7c9e38bdd4a8e20427d92d8cbddf89704ee1e615ad5e8006470cab2eb'),
  magnus: ref('magnus-server', 'b792e1e6d6b999c6fb618001ae718d4664f75f63e3583fc03148209f787c8166'),
  postgres: ref('hive-postgres', 'e52f7dd870240e2ab2c6be2f3bafbcba9b686ec05781c1d8f3f92388af56e30a'),
} as const;
const digestOf = (image: string) => image.slice(image.indexOf('@') + 1);
const pin = (version: string, image: string) => ({ version, image, imageDigest: digestOf(image) });
const service = (name: string, image: string, extra: Partial<RegistryInventory['hosts'][number]['services'][number]> = {}) => ({
  service: name, image, runningImage: image, imageId: `sha256:${'1'.repeat(64)}`, imageMatches: true, state: 'running', health: 'healthy', ...extra,
});
const OBSERVED = '2026-11-20T04:41:00.000Z';

/** Everything on control matches 3.12.9; Magnus runs outside the installation (natively). */
export function inventory3129(overrides: { emberpathImage?: string; receipt?: { version: string; digest: string } } = {}): RegistryInventory {
  return {
    schema: 1,
    installationId: 'example-suite',
    release: { version: '3.12.9', manifestDigest: MANIFEST_3129 },
    components: [
      { id: 'oathweave', displayName: 'Oathweave', kind: 'application', status: 'installed', pinned: pin('2.3.2', IMAGES.oathweave), inventoryHost: 'control' },
      { id: 'emberpath', displayName: 'Emberpath', kind: 'application', status: 'installed', pinned: pin('2.5.4', IMAGES.emberpath), inventoryHost: 'control' },
      { id: 'hivexui', displayName: 'HiveXUI', kind: 'static-ui', status: 'installed', pinned: pin('0.10.3', IMAGES.hivexui), inventoryHost: 'control' },
      { id: 'cindertrace-postgres', displayName: 'Cindertrace PostgreSQL', kind: 'datastore', status: 'installed', pinned: pin('18.7', IMAGES.postgres), inventoryHost: 'control' },
      { id: 'magnus', displayName: 'Magnus', kind: 'application', status: 'external', pinned: pin('3.1.5', IMAGES.magnus), inventoryHost: null },
    ],
    hosts: [
      {
        host: 'control',
        observedAt: OBSERVED,
        receipt: overrides.receipt ?? { version: '3.12.9', digest: MANIFEST_3129 },
        services: [
          service('oathweave', IMAGES.oathweave),
          service('emberpath', overrides.emberpathImage ?? IMAGES.emberpath),
          service('hivexui', IMAGES.hivexui),
          service('cindertrace-postgres', IMAGES.postgres, { health: '' }),
        ],
      },
    ],
  };
}

/** The native Magnus control host after `npm install` of 3.1.5 without the release's override. */
export function nativeMagnus(differences: MagnusInstallation['resolution']['differences'] = [
  { name: 'effect', path: 'node_modules/@prisma/config/node_modules/effect', expected: '3.22.1', actual: '3.20.0' },
]): MagnusInstallation {
  return {
    schema: 1,
    magnus: { version: '3.1.5', node: 'v24.22.3', layout: 'package' },
    resolution: { reference: 'npm-shrinkwrap', referenceSha256: 'a'.repeat(64), checkedAt: '2026-11-20T09:43:00.000Z', checked: 412, differences, truncated: false },
  };
}

export const fleet = (onPin: number, others: Record<string, string | null> = {}) => [
  ...Array.from({ length: onPin }, (_, index) => ({ name: `node-${String(index + 1).padStart(2, '0')}`, version: '3.1.5' })),
  ...Object.entries(others).map(([name, version]) => ({ name, version })),
];
