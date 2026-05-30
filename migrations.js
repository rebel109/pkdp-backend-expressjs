const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const migrationDir = path.resolve(__dirname, '../database/migrations');
const schemaFile = path.resolve(__dirname, '../database/schema.sql');
const seedFile = path.resolve(__dirname, '../database/seed.sql');

function createPool(withDatabase = true) {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: withDatabase ? (process.env.DB_NAME || 'pkdp_db') : undefined,
    waitForConnections: true,
    connectionLimit: 1,
    timezone: '+07:00',
    multipleStatements: true
  });
}

async function ensureDatabaseExists() {
  const dbName = process.env.DB_NAME || 'pkdp_db';
  const pool = createPool(false);
  try {
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await pool.end();
  }
}

async function applySqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8').trim();
  if (!sql) return;
  await connection.query(sql);
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function runInit() {
  await ensureDatabaseExists();
  const pool = createPool(true);
  const connection = await pool.getConnection();
  try {
    console.log('📦 Applying canonical schema');
    await applySqlFile(connection, schemaFile);
    console.log('🌱 Applying minimal seed');
    await applySqlFile(connection, seedFile);
    console.log('✅ Database initialization finished');
  } finally {
    connection.release();
    await pool.end();
  }
}

async function runMigrate() {
  await ensureDatabaseExists();
  const pool = createPool(true);
  const connection = await pool.getConnection();
  try {
    await ensureMigrationTable(connection);
    const migrationFiles = fs.readdirSync(migrationDir)
      .filter(name => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const fileName of migrationFiles) {
      const [[existing]] = await connection.query(
        'SELECT id FROM schema_migrations WHERE filename = ? LIMIT 1',
        [fileName]
      );
      if (existing) {
        console.log(`↩ Skipping ${fileName}`);
        continue;
      }

      console.log(`⏳ Running ${fileName}`);
      await applySqlFile(connection, path.join(migrationDir, fileName));
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [fileName]);
      console.log(`✅ Applied ${fileName}`);
    }

    console.log('✅ Database migrations finished');
  } finally {
    connection.release();
    await pool.end();
  }
}

async function main() {
  const mode = process.argv[2] || 'migrate';
  if (mode === 'init') {
    await runInit();
    return;
  }
  if (mode === 'migrate') {
    await runMigrate();
    return;
  }
  throw new Error(`Unknown mode: ${mode}`);
}

main().catch(error => {
  console.error('❌ Database command failed:', error.message);
  console.error(error);
  process.exit(1);
});
