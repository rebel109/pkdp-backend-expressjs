const mysql = require('mysql2/promise');
require('dotenv').config();
const dbTimeZone = process.env.DB_TIMEZONE || '+07:00';
const pool = mysql.createPool({
  host: process.env.DB_HOST||'localhost',
  port: parseInt(process.env.DB_PORT)||3306,
  user: process.env.DB_USER||'root',
  password: process.env.DB_PASSWORD||'',
  database: process.env.DB_NAME||'pkdp_db',
  waitForConnections:true,
  connectionLimit:10,
  queueLimit:0,
  timezone:dbTimeZone,
  connectTimeout:10000,
  enableKeepAlive:true,
  keepAliveInitialDelay:0,
  dateStrings: ['DATE']
});

const setConnectionTimeZone=connection=>connection.query(`SET time_zone = '${dbTimeZone}'`);
if(typeof pool.on==='function') pool.on('connection',setConnectionTimeZone);
else if(pool.pool&&typeof pool.pool.on==='function') pool.pool.on('connection',setConnectionTimeZone);

pool.getConnection().then(async c=>{await c.query(`SET time_zone = '${dbTimeZone}'`);console.log(`✅  MySQL connected (${dbTimeZone})`);c.release();}).catch(e=>{console.error('❌  MySQL error:',e.message);process.exit(1);});
module.exports = pool;
