import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildWeb } from './build-web.mjs';

const allowedFiles = [
  'app.js', 'games/index.html', 'index.html', 'lively.css', 'portal-premium.css',
  'premium.css', 'settings-drawer.css', 'styles.css',
  'games/runtime.js', 'games/joystick.js', 'games/arcade.css', 'games/modules/platform.js',
  'games/modules/speed.js', 'games/modules/ninja.js', 'games/modules/sword.js', 'games/modules/energy.js',
  'assets/mascot/welcome.mp4', 'assets/mascot/welcome-poster.jpg', 'assets/mascot/welcome.vtt',
  'ble/neuroband.js', 'ble/cloud.js',
].sort();

async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), relative + '/'));
    else files.push(relative);
  }
  return files.sort();
}

test('publicação inclui somente assets permitidos e remove arquivos privados de uma saída anterior', async () => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const fixture = await mkdtemp(path.join(temporaryRoot, 'neurobloom-web-test-'));
  try {
    const fixtureFiles = [...allowedFiles, '.env', 'server/.env', 'server/src/server.js', 'games/private.js', 'ble/private-session.json', 'assets/mascot/source.wav', 'backups/database.sql', 'public/leaked-secret.txt'];
    for (const file of fixtureFiles) {
      const target = path.join(fixture, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `fixture for ${file}`);
    }
    const output = await buildWeb(fixture);
    assert.equal(output, path.join(fixture, 'public'));
    assert.deepEqual(await filesIn(output), allowedFiles);
    for (const file of allowedFiles) {
      assert.equal(await readFile(path.join(output, file), 'utf8'), `fixture for ${file}`);
    }
  } finally {
    // Guard the resolved target before recursively deleting the temporary fixture.
    assert.equal(path.dirname(path.resolve(fixture)), temporaryRoot);
    assert.ok(path.basename(fixture).startsWith('neurobloom-web-test-'));
    await rm(fixture, { recursive: true, force: true });
  }
});

test('Vercel encaminha /api primeiro para HTTPS e mantém as rotas dos dois portais', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'public');
  const api = config.rewrites[0];
  assert.equal(api.source, '/api/:path*');
  assert.match(api.destination, /^https:\/\/[^/]+\/api\/:path\*$/);
  assert.equal(new URL(api.destination).protocol, 'https:');
  for (const route of ['/responsavel', '/responsavel/', '/crianca', '/crianca/']) {
    assert.ok(config.rewrites.some(rewrite => rewrite.source === route && rewrite.destination === '/index.html'));
  }
});

test('assets dos portais resolvem na raiz mesmo quando a URL termina em barra', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const assets = [...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"/g)]
    .map(match => match[1]).filter(value => !value.startsWith('https:'));
  assert.ok(assets.some(value => value.includes('app.js')));
  for (const route of ['/responsavel/', '/crianca/']) {
    for (const asset of assets) {
      const resolved = new URL(asset, 'https://example.com' + route);
      assert.equal(resolved.pathname, '/' + asset.split('?')[0].replace(/^\//, ''));
    }
  }
});
