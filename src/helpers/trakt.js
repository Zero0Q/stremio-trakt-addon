const { fetchUserHistory } = require('../api/trakt');
const { pool } = require('./db');
const log = require('./logger');

/**
* Inserts or updates Trakt tokens for a user in the database.
* @example
* sync('user123', 'accessTokenValue', 'refreshTokenValue')
* undefined
* @param {string} username - The username for which tokens need to be stored.
* @param {string} accessToken - The access token for Trakt API.
* @param {string} refreshToken - The refresh token for regenerating the access token.
* @returns {Promise<void>} Returns a promise that resolves when tokens are saved or rejects with an error.
* @description
*   - The function ensures that tokens are either inserted or updated based on the username.
*   - Logs successful token storage or error details if an exception occurs.
*   - Uses a PostgreSQL database connection to save the tokens.
*/
const saveUserTokens = async (username, accessToken, refreshToken) => {
    try {
        await pool.query(
            `INSERT INTO trakt_tokens (username, access_token, refresh_token) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (username) DO UPDATE SET access_token = $2, refresh_token = $3`,
            [username, accessToken, refreshToken]
        );
        log.info(`Tokens saved for user ${username}`);
    } catch (err) {
        log.error(`Error saving tokens for user ${username}: ${err.message}`);
        throw err;
    }
};

/**
* Fetches Trakt access and refresh tokens for a given username.
* @example
* sync("john_doe")
* { access_token: "abcdef123456", refresh_token: "ghijkl789012" }
* @param {string} username - The username to fetch tokens for.
* @returns {Object} An object containing access_token and refresh_token.
* @description
*   - Throws an error if no tokens are found for the specified user.
*   - Logs a warning if no tokens are found and an error if the query fails.
*/
const fetchUserTokens = async (username) => {
    try {
        const result = await pool.query(
            `SELECT access_token, refresh_token FROM trakt_tokens WHERE username = $1`,
            [username]
        );
        const row = result.rows[0];

        if (!row) {
            log.warn(`No tokens found for user ${username}`);
            throw new Error(`No tokens found for user ${username}`);
        }

        return {
            access_token: row.access_token,
            refresh_token: row.refresh_token,
        };
    } catch (err) {
        log.error(`Error fetching tokens for user ${username}: ${err.message}`);
        throw err;
    }
};

const fetchUserWatchedMovies = async (username, accessToken) => {
    return fetchUserHistory(username, 'movies', accessToken);
};

const fetchUserWatchedShows = async (username, accessToken) => {
    return fetchUserHistory(username, 'shows', accessToken);
};

module.exports = {
    saveUserTokens,
    fetchUserWatchedMovies,
    fetchUserWatchedShows,
    fetchUserTokens
};
