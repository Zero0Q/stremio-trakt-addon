const axios = require('axios');
const log = require('../helpers/logger');
const { getCachedPoster, setCachedPoster } = require('../helpers/cache');

/**
* Retrieves the URL of a poster image from the RPDB API based on the type and ID provided.
* @example
* getRpdbPosterUrl('movie', '12345', 'en-US', 't0-abc123')
* 'https://api.ratingposterdb.com/t0-abc123/tmdb/poster-default/movie-12345.jpg?fallback=true'
* @param {string} type - The type of content (e.g., 'movie', 'tv') for which the poster is requested.
* @param {string} id - The unique identifier for the content.
* @param {string} language - The language code in the format 'xx-YY'.
* @param {string} rpdbApiKey - The API key for accessing the RPDB service, which dictates the tier of service.
* @returns {string|null} The URL of the poster image from RPDB, or null if no poster could be found.
* @description
*   - Caches poster URLs to avoid redundant API requests if possible.
*   - Defaults to using a fallback from TMDB if the RPDB poster isn't available.
*   - Utilizes different fallback strategies depending on the API key tier.
*   - Logs diagnostic messages for cache usage and API operations.
*/
async function getRpdbPosterUrl(type, id, language, rpdbApiKey) {
    const posterId = `poster:${id}`;
    const tier = rpdbApiKey.split("-")[0];
    const lang = language.split("-")[0];
    const baseUrl = `https://api.ratingposterdb.com/${rpdbApiKey}/tmdb/poster-default/${type}-${id}.jpg?fallback=true`;
    const rpdbImageUrl = (tier === "t0" || tier === "t1") ? baseUrl : `${baseUrl}&lang=${lang}`;

    const cachedPoster = await getCachedPoster(posterId);
    if (cachedPoster) {
        log.debug(`Using cached RPDB poster for ID ${posterId}`);
        return cachedPoster.poster_url;
    }

    try {
        const response = await axios.head(rpdbImageUrl);
        if (response.status === 200) {
            log.debug(`RPDB poster found for ID ${posterId}`);
            await setCachedPoster(posterId, rpdbImageUrl);
            return rpdbImageUrl;
        }
    } catch (error) {
        log.warn(`RPDB poster not found for ID ${posterId}, falling back to TMDB: ${error.message}`);
    }

    return null;
}


module.exports = {
    getRpdbPosterUrl
};
