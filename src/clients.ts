/* eslint-disable @typescript-eslint/no-explicit-any -- JSON Schema and generated namespace trees are intentionally dynamic. */
import type { Operation } from './contract.js';
import { readFile } from 'node:fs/promises';

const pythonKeywords = new Set(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
    ' ',
  ),
);
const snake = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const title = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1);
const quote = (value: unknown, python = false) =>
  python
    ? JSON.stringify(value)
        .replace(/^true$/, 'True')
        .replace(/^false$/, 'False')
        .replace(/^null$/, 'None')
    : JSON.stringify(value);
type Schema = Record<string, any>;

function schemaType(schema: Schema, name: string, python: boolean, declarations: string[]): string {
  if (schema.$ref) throw new Error(`${name}: unresolved JSON Schema reference`);
  if (Array.isArray(schema.type))
    return schema.type
      .map((type, index) => schemaType({ ...schema, type }, `${name}${index + 1}`, python, declarations))
      .join(' | ');
  if ('const' in schema) return python ? `Literal[${quote(schema.const, true)}]` : quote(schema.const);
  if (Array.isArray(schema.enum))
    return schema.enum.map((item) => schemaType({ const: item }, name, python, declarations)).join(' | ');
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union))
    return union
      .map((item, index) => schemaType(item, `${name}${index + 1}`, python, declarations))
      .join(' | ');
  if (schema.type === 'array')
    return python
      ? `list[${schemaType(schema.items ?? {}, `${name}Item`, true, declarations)}]`
      : `Array<${schemaType(schema.items ?? {}, `${name}Item`, false, declarations)}>`;
  if (schema.type === 'object') {
    if (!schema.properties) {
      const value = schemaType(
        typeof schema.additionalProperties === 'object' ? schema.additionalProperties : {},
        `${name}Value`,
        python,
        declarations,
      );
      return python ? `dict[str, ${value}]` : `Record<string, ${value}>`;
    }
    const fields = Object.entries(schema.properties as Record<string, Schema>).map(([key, value], index) => {
      const field = schemaType(value, `${name}Field${index + 1}`, python, declarations);
      return python
        ? `${JSON.stringify(key)}: ${(schema.required ?? []).includes(key) ? field : `NotRequired[${field}]`}`
        : `${JSON.stringify(key)}${(schema.required ?? []).includes(key) ? '' : '?'}: ${field}`;
    });
    if (!python) return fields.length ? `{ ${fields.join('; ')} }` : 'Record<string, never>';
    declarations.push(`${name} = TypedDict(${JSON.stringify(name)}, {${fields.join(', ')}})`);
    return name;
  }
  const types: Record<string, [string, string]> = {
    string: ['string', 'str'],
    number: ['number', 'float'],
    integer: ['number', 'int'],
    boolean: ['boolean', 'bool'],
    null: ['null', 'None'],
  };
  return schema.type === undefined
    ? python
      ? 'object'
      : 'unknown'
    : (types[schema.type]?.[Number(python)] ??
        (() => {
          throw new Error(`${name}: unsupported schema type ${schema.type}`);
        })());
}

/** Build standalone SDK sources. Consumers supply their site URL and token to the constructor. */
export async function generateClients(
  operations: Operation[],
  platform: 'sdk-typescript' | 'sdk-python',
  packageName: string,
): Promise<Record<string, string>> {
  const python = platform === 'sdk-python';
  const transport = await readFile(
    new URL(`./templates/client.${python ? 'py' : 'ts'}`, import.meta.url),
    'utf8',
  );
  const declarations: string[] = [];
  const tree: Record<string, Record<string, unknown>> = Object.create(null);
  const types: string[] = [];
  for (const operation of operations) {
    const prefix = title(operation.name);
    const argsType = `${prefix}Args`,
      resultType = `${prefix}Result`;
    if (python && [...operation.resource, operation.action].some((part) => pythonKeywords.has(snake(part))))
      throw new Error(`${operation.name}: Python SDK name is reserved`);
    if (python) {
      for (const [suffix, schema] of [
        ['Args', operation.inputSchema],
        ['Result', operation.outputSchema],
      ] as const) {
        const type = schemaType(schema as Schema, `${prefix}${suffix}`, true, declarations);
        if (type !== `${prefix}${suffix}`) declarations.push(`${prefix}${suffix}: TypeAlias = ${type}`);
      }
    } else {
      types.push(
        `export type ${argsType} = ${schemaType(operation.inputSchema as Schema, argsType, false, types)};`,
      );
      types.push(
        `export type ${resultType} = ${schemaType(operation.outputSchema as Schema, resultType, false, types)};`,
      );
    }
    let branch = tree;
    for (const part of operation.resource) {
      if (part in branch && typeof branch[part] === 'object' && (branch[part] as any).__operation)
        throw new Error(`${operation.name}: SDK namespace conflicts with an operation`);
      branch = (branch[part] ??= Object.create(null)) as Record<string, Record<string, unknown>>;
    }
    if (operation.action in branch)
      throw new Error(`${operation.name}: SDK operation conflicts with a namespace`);
    branch[operation.action] = { __operation: operation, argsType, resultType };
  }
  const defaultArgs = (op: Operation) =>
    !Array.isArray(op.inputSchema.required) || op.inputSchema.required.length === 0;
  if (!python) {
    const render = (node: Record<string, any>): string =>
      `{\n${Object.entries(node)
        .map(([key, value]) =>
          value.__operation
            ? `${JSON.stringify(key)}: (args: ${value.argsType}${defaultArgs(value.__operation) ? ' = {}' : ''}) => request<${value.resultType}>(this._url, this._token, ${JSON.stringify(value.__operation.path)}, args),`
            : `${JSON.stringify(key)}: ${render(value)},`,
        )
        .join('\n')}\n}`;
    return {
      'sdk-typescript.ts': `// Generated by Convex Platforms. Do not edit.\n${transport}\n${types.join('\n')}\nexport class Client {\n  constructor(private readonly _url: string, private readonly _token: string) {}\n${Object.entries(
        tree,
      )
        .map(([key, node]) => `  ${JSON.stringify(key)} = ${render(node as Record<string, any>)};`)
        .join('\n')}\n}\nexport const packageName = ${JSON.stringify(packageName)};\n`,
      'sdk-typescript.package.json':
        JSON.stringify(
          { name: `${packageName}-sdk`, private: true, type: 'module', exports: './sdk-typescript.ts' },
          null,
          2,
        ) + '\n',
    };
  }
  const classes: string[] = [];
  const renderPy = (node: Record<string, any>, className: string) => {
    const children: string[] = [],
      methods: string[] = [];
    const normalized = new Set<string>();
    for (const [key, value] of Object.entries(node)) {
      const method = snake(key);
      if (normalized.has(method)) throw new Error(`${className}: Python SDK names collide`);
      normalized.add(method);
      if (value.__operation) {
        const op = value.__operation as Operation;
        methods.push(
          `    def ${method}(self, args: ${value.argsType}${defaultArgs(op) ? ' | None = None' : ''}) -> ${value.resultType}:\n        return cast(${value.resultType}, _request(self._url, self._token, ${JSON.stringify(op.path)}, ${defaultArgs(op) ? 'args if args is not None else {}' : 'args'}))`,
        );
      } else {
        const child = `${className}${title(key)}`;
        renderPy(value, child);
        children.push(`        self.${method} = ${child}(url, token)`);
      }
    }
    classes.push(
      `class ${className}:\n    def __init__(self, url: str, token: str):\n        self._url, self._token = url, token${children.length ? '\n' + children.join('\n') : ''}${methods.length ? '\n\n' + methods.join('\n\n') : ''}`,
    );
  };
  renderPy(tree, 'Client');
  return {
    'sdk-python.py': `# Generated by Convex Platforms. Requires Python 3.11+.\nfrom typing import Literal, NotRequired, TypedDict, TypeAlias, cast\n\n${transport}\n\n${declarations.join('\n\n')}\n\n${classes.join('\n\n')}\n`,
    'sdk-python.package.json':
      JSON.stringify({ name: `${packageName}-python-sdk`, private: true }, null, 2) + '\n',
  };
}
