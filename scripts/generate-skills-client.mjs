import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2),
  input = args.indexOf('--spec');
const file =
  input < 0
    ? new URL('../contracts/hiveskills.openapi.json', import.meta.url)
    : args[input + 1];
const bytes = readFileSync(file),
  spec = JSON.parse(bytes);
if (spec.openapi !== '3.1.0' || !spec.components?.schemas)
  throw Error('An owned OpenAPI 3.1 contract is required');
function schema(node) {
  if (node.$ref)
    throw Error('Resolve component references explicitly before generation');
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
        (node.pattern
          ? `.regex(new RegExp(${JSON.stringify(node.pattern)}))`
          : '')
      );
    case 'integer':
      return 'z.number().int()';
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'array':
      return `z.array(${schema(node.items)})`;
    case 'object':
      return `z.object({${Object.entries(node.properties ?? {})
        .map(
          ([key, value]) =>
            `${JSON.stringify(key)}:${schema(value)}${node.required?.includes(key) ? '' : '.optional()'}`,
        )
        .join(',')}})`;
    default:
      throw Error('Unsupported contract schema');
  }
}
const output =
  `// Generated from HiveSkills OpenAPI ${spec.info.version}; SHA256 ${createHash('sha256').update(bytes).digest('hex')}.\n// Apache-2.0. Source attribution: HiveSkills, extracted from Hive.\nimport {z} from 'zod';\n` +
  Object.entries(spec.components.schemas)
    .map(([name, node]) => {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name))
        throw Error('Invalid schema identifier');
      return `export const ${name}Schema=${schema(node)};\nexport type ${name}=z.infer<typeof ${name}Schema>;\n`;
    })
    .join('');
const target = new URL('../contracts/hiveskills.generated.ts', import.meta.url);
if (args.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output)
    throw Error('HiveSkills client drift');
} else writeFileSync(target, output);
