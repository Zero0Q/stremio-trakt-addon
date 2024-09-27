const axios = require('axios');
const log = require('../helpers/logger');
const addToQueueTMDB = require('../helpers/bottleneck_tmdb');
const { safeRedisCall } = require('../helpers/redis');
const { parseCacheDuration } = require('../helpers/cache');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const generateRedisKey = (tmdbId, type, language) => {
    return `tmdb:${type}:${tmdbId}:${language}`;
};

const getMetadataByTmdbId = async (tmdbId, type, tmdbApiKey, language = 'en-US') => {
    const redisKey = generateRedisKey(tmdbId, type, language);
    const endpoint = `${TMDB_BASE_URL}/${type}/${tmdbId}?language=${language}&api_key=${tmdbApiKey}`;

    try {
        const cachedData = await safeRedisCall('get', redisKey);
        if (cachedData) {
            log.debug(`TMDB data for ${type} with ID ${tmdbId} in language ${language} found in cache.`);
            return JSON.parse(cachedData);
        }

        const response = await addToQueueTMDB({
            fn: () => axios.get(endpoint)
        });

        const data = response.data;

        const result = {
            title: data.title || data.name,
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            description: data.overview,
            releaseDate: data.release_date || data.first_air_date,
        };

        const cacheDuration = parseCacheDuration(process.env.TMDB_CACHE_DURATION || '1d');
        await safeRedisCall('set', redisKey, JSON.stringify(result), 'EX', cacheDuration);

        log.debug(`TMDB API request successful for ${type} with ID ${tmdbId} in language ${language}. Data cached.`);

        return result;
    } catch (error) {
        log.error(`Error fetching TMDB details for ${type} with ID ${tmdbId}: ${error.message}`);
        throw error;
    }
};

module.exports = {
    getMetadataByTmdbId
};
