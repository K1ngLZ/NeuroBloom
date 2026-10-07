import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only browser assets are published. Backend code, credentials and backups
// must never become static downloads on Vercel.
export const publicAssets = [
  'index.html', 'app.js', 'styles.css', 'premium.css', 'portal-premium.css',
  'games/index.html'
];

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function buildWeb(root = projectRoot) {
  const output = path.resolve(root, 'public');
  if (path.dirname(output) !== path.resolve(root)) {
    throw new Error('Diretório de publicação fora do projeto.');
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const asset of publicAssets) {
    const destination = path.join(output, asset);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, asset), destination);
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWeb();
  console.log('Frontend preparado em public/ (somente arquivos públicos).');
}
