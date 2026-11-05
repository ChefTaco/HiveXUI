// Compatibility entrypoint: consume exact owning-product exports, preserving refinements.
// Update the reviewed vendored export and provenance together; never reconstruct Zod from JSON.
if (!process.argv.includes('--check')) throw Error('Copy the owning product docs/browser-contracts.ts export and reviewed SHA256 provenance; UI contract generation is retired');
await import('./check-owned-identity-skills.mjs');
