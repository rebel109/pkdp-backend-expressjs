// Jalankan: node utils/resetAdmin.js
const bcrypt=require('bcrypt'),mysql=require('mysql2/promise');
require('dotenv').config();
async function reset(){
  const hash=await bcrypt.hash('admin123',12);
  const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  await db.query('DELETE FROM profiles WHERE user_id=1');
  await db.query('DELETE FROM users WHERE id=1');
  await db.query(`INSERT INTO users (id,name,email,password,role,status) VALUES (1,'Administrator','admin@pkdp.id',?,'ADMIN','active')`,[hash]);
  await db.query('INSERT INTO profiles (user_id) VALUES (1)');
  console.log('✅ Admin reset!\nEmail: admin@pkdp.id\nPassword: admin123');
  db.end();
}
reset().catch(console.error);
