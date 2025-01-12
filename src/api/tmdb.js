const axios = require('axios');
const log = require('../helpers/logger');
const addToQueueTMDB = require('../helpers/bottleneck_tmdb');
const { safeRedisCall } = require('../helpers/redis');
const { parseCacheDuration } = require('../helpers/cache');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const generateRedisKey = (tmdbId, type, language) => {
    return `tmdb:${type}:${tmdbId}:${language}`;
};

/**
* Converts a runtime in minutes to a formatted string.
* @example
* formatRuntime(125)
* "2h05"
* @param {number} runtime - The runtime in minutes to be formatted.
* @returns {string|null} The formatted runtime string, or null if runtime is not provided.
* @description
*   - Formats single-digit minutes to two digits.
*   - Handles cases where only hours or only minutes are present.
*/
const formatRuntime = (runtime) => {
    if (!runtime) return null;

    const hours = Math.floor(runtime / 60);
    const minutes = runtime % 60;

    if (hours > 0 && minutes > 0) {
        return `${hours}h${minutes.toString().padStart(2, '0')}`;
    } else if (hours > 0) {
        return `${hours}h`;
    } else {
        return `${minutes}m`;
    }
};

/**
* Fetches and caches data from TMDB based on the provided parameters and synchronization settings.
* @example
* sync(12345, 'movie', 'your_tmdb_api_key')
* Returns an object with movie data including title, poster, and release date.
* @param {number} tmdbId - The TMDB ID of the media (movie or show).
* @param {string} type - The type of the media, either 'movie' or 'tv'.
* @param {string} tmdbApiKey - The API key to authenticate with TMDB.
* @param {string} [language='en-US'] - The language code to fetch data in.
* @returns {Object} Returns an object containing media details such as title, poster, description, release date, last air date, IMDb rating, genres, and runtime.
* @description
*   - Attempts to retrieve data from cache before making an API call to reduce latency and load.
*   - Caches API responses with a configurable expiration to ensure updated information is fetched periodically.
*   - Handles and logs errors during data retrieval for better debugging and monitoring.
*   - Formats and organizes API data into a consistent structure for easy consumption.
*/
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
            releaseDate: (data.release_date || data.first_air_date || '').slice(0, 4),
            lastAirDate: data.last_air_date ? data.last_air_date.slice(0, 4) : null,
            imdbRating: data.vote_average ? data.vote_average.toFixed(1) : null,
            genres: data.genres ? data.genres.map(genre => genre.name) : [],
            runtime: formatRuntime(data.runtime)
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

module.exports = { getMetadataByTmdbId };
