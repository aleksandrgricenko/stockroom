import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

export async function databaseFixture() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('Задайте TEST_DATABASE_URL для PostgreSQL. См. .env.example.');
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString });
  const db = new pg.Pool({ connectionString, options: '-c search_path=' + schema, application_name: schema });
  async function close() {
    await db.end();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const file of ['001-init.sql', '002-demo.sql']) {
      await db.query(await readFile(new URL('../db/' + file, import.meta.url), 'utf8'));
    }
    return { db, schema, close };
  } catch (error) {
    await close();
    throw error;
  }
}
