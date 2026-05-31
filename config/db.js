const mysql = require('mysql2/promise');
require('dotenv').config();
const pool = mysql.createPool({
  host: process.env.DB_HOST||'localhost',
  port: parseInt(process.env.DB_PORT)||3306,
  user: process.env.DB_USER||'root',
  password: process.env.DB_PASSWORD||'',
  database: process.env.DB_NAME||'pkdp_db',
  waitForConnections:true,
  connectionLimit:10,
  queueLimit:0,
  timezone:'+07:00',
  connectTimeout:10000,
  enableKeepAlive:true,
  keepAliveInitialDelay:0
});
pool.getConnection().then(c=>{console.log('✅  MySQL connected');c.release();}).catch(e=>{console.error('❌  MySQL error:',e.message);process.exit(1);});
module.exports = pool;
