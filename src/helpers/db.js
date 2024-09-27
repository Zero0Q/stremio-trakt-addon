const { Pool } = require('pg');
const log = require('../helpers/logger');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: process.env.DB_MAX_CONNECTIONS,
    idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT,
    connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT,
});

const createDatabaseAndTable = async (createTableSQL) => {
    let client;
    try {
        client = await pool.connect();
        const commands = createTableSQL.split(';');
        for (let command of commands) {
            if (command.trim()) {
                await client.query(command);
                log.debug('Table created or already exists');
            }
        }
    } catch (err) {
        log.error('Error executing query', err.stack);
    } finally {
        if (client) client.release();
    }
};

const traktDb = createDatabaseAndTable(
    `CREATE TABLE IF NOT EXISTS trakt_tokens (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        last_fetched_at TIMESTAMP DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS trakt_history (
        id SERIAL PRIMARY KEY,
        username TEXT,
        watched_at TIMESTAMP,
        type TEXT,
        title TEXT,
        imdb_id TEXT,
        tmdb_id INTEGER,
        FOREIGN KEY (username) REFERENCES trakt_tokens(username) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_trakt_history_username ON trakt_history(username);
    `
);

module.exports = {
    pool,
    traktDb
};
