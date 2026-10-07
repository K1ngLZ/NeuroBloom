import 'dotenv/config';
import { buildApp } from './app.js';
import { readConfig } from './config.js';

let app;
try {
  const config = readConfig();
  app = await buildApp({ config });
  await app.listen({ port: config.port, host: config.host });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await app.close();
      process.exitCode = 0;
    });
  }
} catch (error) {
  if (app) {
    app.log.error({ code: error.code }, 'Não foi possível iniciar a API.');
    await app.close();
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
}
