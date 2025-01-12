const { createClient } = require('redis');
const log = require('./logger');

let redisUnavailable = false;
let hasLoggedError = false;

const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST || 'https://stremio-trakt-dddon-5b1d9b989d0b.herokuapp.com',
        port: process.env.REDIS_PORT || 6379,
    },
    password: process.env.REDIS_PASSWORD || null,
});

redisClient.on('ready', () => {
    if (redisUnavailable) {
        redisUnavailable = false;
        hasLoggedError = false;
        log.info('Redis is ready and connected.');
    }
});

redisClient.on('end', () => {
    if (!redisUnavailable) {
        redisUnavailable = true;
        log.warn('Redis connection closed. Marking as unavailable.');
    }
});

redisClient.on('error', (err) => {
    if (!redisUnavailable) {
        redisUnavailable = true;
    }
    if (!hasLoggedError) {
        log.error(`Redis error: ${err}. Marking Redis as unavailable.`);
        hasLoggedError = true;
    }
});

redisClient.connect().catch((err) => {
    if (!hasLoggedError) {
        log.error(`Failed to connect to Redis: ${err}. Disabling Redis cache temporarily.`);
        hasLoggedError = true;
    }
    redisUnavailable = true;
});

/**
* Performs a synchronous Redis cache operation.
* @example
* sync('set', 'key', 'value')
* 'OK'
* @param {string} operation - The Redis operation to perform.
* @param {...*} args - The arguments to pass to the Redis operation.
* @returns {Promise<*>|null} The result of the Redis operation or null if Redis is unavailable.
* @description
*   - Logs a warning if Redis is unavailable and skips the operation.
*   - Tries to execute the specified Redis operation and catches errors.
*   - Marks Redis as unavailable if an operation error occurs and logs the error message.
*/
const safeRedisCall = async (operation, ...args) => {
    if (redisUnavailable) {
        log.warn('Redis is unavailable, skipping cache operation.');
        return null;
    }

    try {
        return await redisClient[operation](...args);
    } catch (err) {
        if (!redisUnavailable) {
            redisUnavailable = true;
            log.error(`Redis operation failed: ${err}. Marking Redis as unavailable.`);
        }
        return null;
    }
};

module.exports = {
    redisClient,
    safeRedisCall
};
