import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não configurada.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '..', 'schema.sql');
const sql = await fs.readFile(schemaPath, 'utf8');

const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 30000 });

try {
  await client.connect();
  await client.query(sql);
  console.log('Schema NeuroBloom aplicado com sucesso.');
} catch (error) {
  console.error('Falha ao aplicar schema. Verifique a conexão/permissões do banco.', error.code || 'erro de conexão');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
