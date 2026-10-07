import { mkdir, chmod, cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
const result = Bun.spawnSync(['bunx', 'tsc', '--emitDeclarationOnly'], {
  stdout: 'inherit',
  stderr: 'inherit',
});
if (result.exitCode) process.exit(result.exitCode);
await mkdir('dist', { recursive: true });
const files = [...new Bun.Glob('*.{ts,tsx}').scanSync('src')];
for (const file of files) {
  const source = await Bun.file(`src/${file}`).text();
  const output = file.replace(/\.tsx?$/, '.js');
  const transpiler = new Bun.Transpiler({ loader: file.endsWith('.tsx') ? 'tsx' : 'ts', target: 'node' });
  let emitted = transpiler.transformSync(source);
  if (source.startsWith('#!') && !emitted.startsWith('#!'))
    emitted = source.slice(0, source.indexOf('\n')) + '\n' + emitted;
  await Bun.write(`dist/${output}`, emitted);
}
if (await Bun.file('dist/cli.js').exists()) await chmod('dist/cli.js', 0o755);
if ([...new Bun.Glob('**/*').scanSync('src/templates')].length)
  await cp('src/templates', 'dist/templates', { recursive: true });
