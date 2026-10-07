const mysql = require('mysql2/promise');

let pool;

if (process.env.DATABASE_URL) {
  pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false }
  });
  console.log('DB: using DATABASE_URL');
} else {
  pool = mysql.createPool({
    host:     process.env.DB_HOST || 'localhost',
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'lokshin_gigs',
    port:     parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  console.log('DB: using local config');
}

pool.getConnection()
  .then(c => { console.log('DB: connected ✓'); c.release(); })
  .catch(e => console.error('DB: connection failed —', e.message));

module.exports = pool;
