import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only browser assets are published. Backend code, credentials and backups
// must never become static downloads on Vercel.
export const publicAssets = [
  'index.html', 'app.js', 'styles.css', 'premium.css', 'portal-premium.css',
  'lively.css', 'settings-drawer.css',
  'games/index.html', 'games/runtime.js', 'games/joystick.js', 'games/arcade.css',
  'games/modules/platform.js', 'games/modules/speed.js', 'games/modules/ninja.js',
  'games/modules/sword.js', 'games/modules/energy.js',
  'assets/mascot/welcome.mp4', 'assets/mascot/welcome-poster.jpg', 'assets/mascot/welcome.vtt',
  'ble/neuroband.js', 'ble/cloud.js'
];

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function buildWeb(root = projectRoot) {
  const resolvedRoot = path.resolve(root);
  const output = path.join(resolvedRoot, 'public');
  if (path.dirname(output) !== resolvedRoot) {
    throw new Error('Diretório de publicação fora do projeto.');
  }
  // Validate every ancestor before copying. An allowlisted filename inside a
  // symlink/junction could otherwise publish files from a private directory.
  for (const asset of publicAssets) {
    const segments = asset.split('/');
    let source = resolvedRoot;
    for (const [index, segment] of segments.entries()) {
      if (!segment || segment === '.' || segment === '..' || path.isAbsolute(segment)) {
        throw new Error('Caminho de asset público inválido.');
      }
      source = path.join(source, segment);
      const info = await lstat(source);
      if (info.isSymbolicLink()) throw new Error(`Links simbólicos não são publicados: ${asset}`);
      const final = index === segments.length - 1;
      if (final ? !info.isFile() : !info.isDirectory()) {
        throw new Error(`Asset público inválido: ${asset}`);
      }
    }
  }
  try {
    const info = await lstat(output);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Diretório de publicação deve ser uma pasta real do projeto.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const asset of publicAssets) {
    const destination = path.join(output, asset);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(resolvedRoot, asset), destination);
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWeb();
  console.log('Frontend preparado em public/ (somente arquivos públicos).');
}
