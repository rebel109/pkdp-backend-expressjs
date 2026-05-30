const mysql=require('mysql2/promise');
const fs=require('fs');
const path=require('path');
require('dotenv').config();

async function ensureBaseTables(db){
  const sqlPath=path.resolve(__dirname,'../../database/alter_add_certificates.sql');
  const sql=fs.readFileSync(sqlPath,'utf8');
  const statements=sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s=>s.trim())
    .filter(Boolean);

  for(const statement of statements){
    await db.query(statement);
  }
}

async function migrate(){
  const db=await mysql.createConnection({
    host:process.env.DB_HOST,
    user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,
    database:process.env.DB_NAME
  });

  await ensureBaseTables(db);

  const alterQueries=[
    "ALTER TABLE certificate_settings ADD COLUMN signer1_nip VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE certificate_settings ADD COLUMN signer2_nip VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE certificate_settings ADD COLUMN sample_date_text VARCHAR(255) DEFAULT 'Palembang, 19 Mei 2026'",
    "ALTER TABLE certificate_settings ADD COLUMN certificate_no_start INT DEFAULT 1",
    "ALTER TABLE certificate_settings ADD COLUMN signer1_cap_file VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE certificate_settings ADD COLUMN signer2_cap_file VARCHAR(500) DEFAULT NULL"
  ];

  for(const q of alterQueries){
    try{
      await db.query(q);
      console.log('OK:', q);
    }catch(e){
      if(e.code==='ER_DUP_FIELDNAME') console.log('SKIP:', e.message);
      else console.log('ERROR:', e.code, e.message);
    }
  }

  await db.end();
  console.log('Certificate settings migration complete');
}

migrate().catch(err=>{
  console.error(err);
  process.exit(1);
});
