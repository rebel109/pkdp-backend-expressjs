const mysql=require('mysql2/promise');
require('dotenv').config();
async function migrate(){
  const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});

  const alterQueries = [
    "ALTER TABLE profiles ADD COLUMN avatar_url VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN gender ENUM('L','P') DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN nik VARCHAR(20) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN nidn VARCHAR(20) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN birthplace VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN birthdate DATE DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN unit_kerja VARCHAR(255) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN city VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN employee_status ENUM('PNS','PPPK','NON_PNS') DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN sk_file VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN functional_title ENUM('ASISTEN_AHLI','LEKTOR','LEKTOR_KEPALA') DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN functional_title_file VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN diploma_file VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN golongan VARCHAR(20) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN npwp VARCHAR(20) DEFAULT NULL",
    "ALTER TABLE profiles ADD COLUMN is_complete TINYINT(1) DEFAULT 0",
    "ALTER TABLE users ADD COLUMN profile_complete TINYINT(1) DEFAULT 0"
  ];

  for(const q of alterQueries){
    try{
      await db.query(q);
      console.log('OK:', q.substring(0,60));
    }catch(e){
      if(e.code==='ER_DUP_FIELDNAME'){
        console.log('SKIP:', e.message.substring(0,50));
      }else{
        console.log('ERROR:', e.code, e.message.substring(0,50));
      }
    }
  }
  console.log('Migration complete');
  db.end();
}
migrate().catch(console.error);
