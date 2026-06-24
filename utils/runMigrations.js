const mysql = require('mysql2/promise');
require('dotenv').config();

async function runMigrations(db) {
  const migrations = [
    {
      name: 'add_grade_is_draft',
      query: 'ALTER TABLE grades ADD COLUMN is_draft TINYINT(1) DEFAULT 0 AFTER is_locked',
      skipCode: 'ER_DUP_FIELDNAME'
    }
  ];

  for (const m of migrations) {
    try {
      await db.query(m.query);
      console.log('[migration] OK:', m.name);
    } catch (e) {
      if (e.code === m.skipCode) {
        console.log('[migration] SKIP:', m.name, '(already exists)');
      } else {
        console.log('[migration] ERROR:', m.name, e.code, e.message.substring(0, 80));
      }
    }
  }
}

module.exports = { runMigrations };
