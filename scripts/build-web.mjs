import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webDir = resolve(projectRoot, 'web');
const distDir = resolve(projectRoot, 'dist');
const assetsDir = resolve(distDir, 'assets');
const isDev = process.argv.includes('--dev');

function hashContent(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function replaceTag(source, pattern, replacement, tagName) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`Failed to replace ${tagName} tag in web/index.html`);
  }
  return next;
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  const buildResult = await build({
    entryPoints: [resolve(webDir, 'src/app.js')],
    bundle: true,
    format: 'esm',
    minify: !isDev,
    sourcemap: isDev ? 'external' : false,
    target: ['es2020'],
    outdir: assetsDir,
    entryNames: 'app.[hash]',
    logLevel: 'info',
    write: true,
    metafile: true,
  });

  const jsOutput = Object.keys(buildResult.metafile.outputs).find(
    (outputPath) => outputPath.endsWith('.js') && outputPath.includes('/assets/app.')
  );
  if (!jsOutput) {
    throw new Error('Could not determine built JS output file.');
  }
  const jsFile = basename(jsOutput);

  const cssSource = await readFile(resolve(webDir, 'styles.css'), 'utf8');
  const cssOut = await transform(cssSource, {
    loader: 'css',
    minify: !isDev,
    sourcemap: false,
  });
  const cssHash = hashContent(cssOut.code);
  const cssFile = `styles.${cssHash}.css`;
  await writeFile(resolve(assetsDir, cssFile), cssOut.code, 'utf8');

  const indexTemplate = await readFile(resolve(webDir, 'index.html'), 'utf8');
  let indexOut = indexTemplate;
  indexOut = replaceTag(
    indexOut,
    /<link\s+rel="stylesheet"\s+href="[^"]+"\s*\/>/,
    `<link rel="stylesheet" href="/assets/${cssFile}" />`,
    'stylesheet'
  );
  indexOut = replaceTag(
    indexOut,
    /<script\s+type="module"\s+src="[^"]+"\s*><\/script>/,
    `<script type="module" src="/assets/${jsFile}"></script>`,
    'module script'
  );

  await writeFile(resolve(distDir, 'index.html'), indexOut, 'utf8');

  const headers = [
    '/index.html',
    '  Cache-Control: no-cache',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/api/*',
    '  Cache-Control: no-store',
    '',
  ].join('\n');
  await writeFile(resolve(distDir, '_headers'), headers, 'utf8');

  console.log(`Built web assets to ${distDir}`);
  console.log(`JS: /assets/${jsFile}`);
  console.log(`CSS: /assets/${cssFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
