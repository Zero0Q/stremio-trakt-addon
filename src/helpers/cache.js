const log = require('../helpers/logger');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { CACHE_POSTER_CONTENT_DURATION_DAYS } = process.env;
const baseUrl = process.env.BASE_URL || 'https://stremio-trakt-dddon-5b1d9b989d0b.herokuapp.com';

const defaultCacheDurationDays = 3;

const posterCacheDurationDays = parseInt(CACHE_POSTER_CONTENT_DURATION_DAYS, 10) || defaultCacheDurationDays;
const posterCacheDurationMillis = posterCacheDurationDays * 24 * 60 * 60 * 1000;

log.debug(`Cache duration for posters: ${posterCacheDurationMillis} milliseconds (${posterCacheDurationDays} days)`);

const posterDirectory = path.join(__dirname, '../../cache/rpdbPosters');

if (!fs.existsSync(posterDirectory)) {
    fs.mkdirSync(posterDirectory, { recursive: true });
}

const formatFileName = (posterId) => {
    return posterId.replace(/[^a-zA-Z0-9-_]/g, '_');
};

/**
 * Checks the cache for a poster and returns its URL if present and valid.
 * @example
 * checkPosterCache(posterId)
 * { poster_url: 'http://example.com/poster/12345.jpg' }
 * @param {string} posterId - The ID of the poster to be checked in the cache.
 * @returns {Object|null} An object containing the poster URL if cached and valid, otherwise null.
 * @description
 *   - Formats the posterId to create the expected filename for the cache.
 *   - Checks if the file exists and is not expired based on a defined cache duration.
 *   - Logs whether the poster URL was served from the cache or missed.
 */
const getCachedPoster = async (posterId) => {
    const formattedPosterId = formatFileName(posterId);
    const filePath = path.join(posterDirectory, `${formattedPosterId}.jpg`);
    const fileStats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;

    if (fileStats && (Date.now() - fileStats.mtimeMs < posterCacheDurationMillis)) {
        const posterUrl = `${baseUrl}/poster/${formattedPosterId}.jpg`;
        log.debug(`Cache hit for poster id ${posterId}, serving from ${posterUrl}`);
        return { poster_url: posterUrl };
    } else {
        log.debug(`Cache miss or expired for poster id ${posterId}`);
        return null;
    }
};

/**
* Caches a poster image locally by downloading it from a given URL.
* @example
* sync("12345", "http://example.com/poster.jpg")
* // No return value; caches the image locally
* @param {string} posterId - The unique identifier for the poster.
* @param {string} posterUrl - The URL from which to download the poster image.
* @returns {void} No return value. Throws an error if the download or write operation fails.
* @description
*   - Uses axios to perform a GET request with responseType 'arraybuffer'.
*   - Writes the fetched image data to a local file system at a pre-defined directory.
*   - Logs debug information if caching is successful, and error details upon failure.
*/
const setCachedPoster = async (posterId, posterUrl) => {
    const formattedPosterId = formatFileName(posterId);
    const filePath = path.join(posterDirectory, `${formattedPosterId}.jpg`);

    try {
        const response = await axios.get(posterUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(filePath, response.data);
        log.debug(`Poster id ${posterId} cached at ${filePath}`);
    } catch (error) {
        log.error(`Error caching poster id ${posterId} from URL ${posterUrl}: ${error.message}`);
        throw error;
    }
};

const parseCacheDuration = (duration) => {
    const match = duration.match(/^(\d+)([dh])$/);
    if (!match) {
        throw new Error("Invalid cache duration format. Use '<number>d' for days or '<number>h' for hours.");
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    return unit === 'd' ? value * 86400 : value * 3600;
};

module.exports = {
    getCachedPoster,
    setCachedPoster,
    parseCacheDuration
};
