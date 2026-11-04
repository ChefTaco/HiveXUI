import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = readFileSync(
  new URL('../contracts/hivemem.openapi.json', import.meta.url),
);
const spec = JSON.parse(bytes);
const names = [
  'MemoryProfile',
  'Workspace',
  'WorkspaceMember',
  'WorkspacePolicy',
  'WorkspaceCreate',
  'WorkspaceUpdate',
  'WorkspaceMemberUpdate',
];
if (spec.openapi !== '3.1.0')
  throw Error('An owned OpenAPI 3.1 contract is required');
function schema(node) {
  if (node.nullable) {
    const copy = { ...node };
    delete copy.nullable;
    return schema(copy) + '.nullable()';
  }
  if (node.$ref)
    throw Error('Resolve references before exporting browser contracts');
  if (node.const !== undefined)
    return `z.literal(${JSON.stringify(node.const)})`;
  if (node.enum) return `z.enum(${JSON.stringify(node.enum)})`;
  if (node.anyOf) return `z.union([${node.anyOf.map(schema).join(',')}])`;
  if (Array.isArray(node.type))
    return `z.union([${node.type.map((type) => schema({ ...node, type })).join(',')}])`;
  switch (node.type) {
    case 'string':
      return (
        'z.string()' +
        (node.minLength !== undefined ? `.min(${node.minLength})` : '') +
        (node.maxLength !== undefined ? `.max(${node.maxLength})` : '') +
        (node.pattern
          ? `.regex(new RegExp(${JSON.stringify(node.pattern)}))`
          : '')
      );
    case 'integer':
    case 'number':
      return (
        'z.number()' +
        (node.type === 'integer' ? '.int()' : '') +
        (node.minimum !== undefined ? `.min(${node.minimum})` : '') +
        (node.maximum !== undefined ? `.max(${node.maximum})` : '')
      );
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'array':
      return `z.array(${schema(node.items)})`;
    case 'object':
      if (!node.properties && node.additionalProperties !== false)
        return `z.record(z.string(),${schema(typeof node.additionalProperties === 'object' ? node.additionalProperties : {})})`;
      return `z.object({${Object.entries(node.properties ?? {})
        .map(
          ([key, value]) =>
            `${JSON.stringify(key)}:${schema(value)}${node.required?.includes(key) ? '' : '.optional()'}`,
        )
        .join(',')}})`;
    default:
      if (node.type === undefined) return 'z.unknown()';
      throw Error('Unsupported memory contract schema');
  }
}
const output =
  `// Generated from HiveMem OpenAPI ${spec.info.version}; SHA256 ${createHash('sha256').update(bytes).digest('hex')}.\n// Apache-2.0. Source attribution: HiveMem, extracted from Hive.\nimport {z} from 'zod';\n` +
  names
    .map((name) => {
      const node = spec.components.schemas[name];
      if (!node) throw Error('Missing memory schema: ' + name);
      return `export const ${name}Schema=${schema(node)};\nexport type ${name}=z.infer<typeof ${name}Schema>;\n`;
    })
    .join('');
const file = new URL('../contracts/hivemem.generated.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== output)
    throw Error('HiveMem browser client drift');
} else writeFileSync(file, output);
