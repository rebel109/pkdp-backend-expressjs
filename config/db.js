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

// Errors that mean the pooled connection was dropped by the server while idle
// (common when MySQL wait_timeout is short). The connection is dead but the
// pool will hand us a fresh one on the next attempt, so a single retry recovers.
const DEAD_CONNECTION_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ER_CLIENT_INTERACTION_TIMEOUT'
]);

const isDeadConnectionError = err => {
  if(!err) return false;
  if(DEAD_CONNECTION_CODES.has(err.code)) return true;
  // mysql2 surfaces "Can't add new command when connection is in closed state"
  // and similar fatal socket errors with fatal=true and no SQL state.
  return err.fatal === true && !err.sqlState;
};

// Wrap query/execute so a dead-connection error transparently retries once
// against a freshly-created pool connection. Successful queries are unaffected.
const withRetry = method => async (...args) => {
  try {
    return await pool[method](...args);
  } catch (err) {
    if(isDeadConnectionError(err)){
      return pool[method](...args);
    }
    throw err;
  }
};

const db = {
  query: withRetry('query'),
  execute: withRetry('execute'),
  getConnection: (...args) => pool.getConnection(...args),
  end: (...args) => pool.end(...args),
  // Expose the raw pool for callers that need transactions or pool internals.
  pool
};

// Keep idle connections warm so the server doesn't reap them between requests.
// A lightweight SELECT 1 every 5 minutes is well under the typical 10-minute
// wait_timeout and prevents the "first click after idle returns empty" issue.
const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
const keepAlive = setInterval(() => {
  pool.query('SELECT 1').catch(e => console.error('⚠️  DB keepalive failed:', e.message));
}, KEEPALIVE_INTERVAL_MS);
if(typeof keepAlive.unref === 'function') keepAlive.unref();

pool.getConnection().then(async c=>{await c.query(`SET time_zone = '${dbTimeZone}'`);console.log(`✅  MySQL connected (${dbTimeZone})`);c.release();}).catch(e=>{console.error('❌  MySQL error:',e.message);process.exit(1);});
module.exports = db;
