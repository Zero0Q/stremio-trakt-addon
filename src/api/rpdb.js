const axios = require('axios');
const log = require('../helpers/logger');
const { getCachedPoster, setCachedPoster } = require('../helpers/cache');

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
