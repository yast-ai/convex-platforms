import { mkdir, chmod, cp } from 'node:fs/promises';
const result = Bun.spawnSync(['bunx', 'tsc', '--emitDeclarationOnly'], { stdout: 'inherit', stderr: 'inherit' });
if (result.exitCode) process.exit(result.exitCode);
await mkdir('dist', { recursive: true });
const files = [...new Bun.Glob('*.{ts,tsx}').scanSync('src')];
for (const file of files) {
  const source = await Bun.file(`src/${file}`).text();
  const output = file.replace(/\.tsx?$/, '.js');
  const transpiler = new Bun.Transpiler({ loader: file.endsWith('.tsx') ? 'tsx' : 'ts', target: 'node' });
  await Bun.write(`dist/${output}`, transpiler.transformSync(source));
}
if (await Bun.file('dist/cli.js').exists()) await chmod('dist/cli.js', 0o755);
if (await Bun.file('src/templates/.keep').exists()) await cp('src/templates', 'dist/templates', { recursive: true });
