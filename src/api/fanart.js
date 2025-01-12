const axios = require('axios');
const log = require('../helpers/logger');

/**
* Fetches the best movie logo URL from Fanart.tv in the preferred language or English if unavailable.
* @example
* sync('123456', 'es', 'yourFanartApiKey')
* 'https://example.com/logo.png'
* @param {string} tmdbId - The TMDB ID of the movie.
* @param {string} preferredLang - The preferred language for the logos.
* @param {string} fanartApiKey - The API key for accessing the Fanart.tv service.
* @returns {string} URL of the best logo image, or an empty string if no logos are found.
* @description
*   - Uses axios to perform HTTP requests to the Fanart.tv API.
*   - Prioritizes logos in the specified preferred language, falling back to English logos if none are found.
*   - Logos are sorted by the number of likes to determine the 'best' one.
*   - Ensures all returned URLs use HTTPS.
*/
const getFanartLogo = async (tmdbId, preferredLang, fanartApiKey) => {
    try {
        const url = `https://webservice.fanart.tv/v3/movies/${tmdbId}/?api_key=${fanartApiKey}`;
        
        log.debug(`Fetching Fanart logos from: ${url}`);

        const response = await axios.get(url);
        const logos = response.data.hdmovielogo || [];
        
        log.debug(`Logos fetched: ${JSON.stringify(logos)}`);

        const preferredLangLogos = logos.filter(logo => logo.lang === preferredLang);
        log.debug(`Logos in preferred language (${preferredLang}): ${JSON.stringify(preferredLangLogos)}`);

        const bestLogoInPreferredLang = preferredLangLogos.sort((a, b) => b.likes - a.likes)[0];
        log.debug(`Best logo in preferred language: ${JSON.stringify(bestLogoInPreferredLang)}`);

        if (!bestLogoInPreferredLang) {
            const englishLogos = logos.filter(logo => logo.lang === 'en');
            log.debug(`Logos in English: ${JSON.stringify(englishLogos)}`);

            const bestLogoInEnglish = englishLogos.sort((a, b) => b.likes - a.likes)[0];
            log.debug(`Best logo in English: ${JSON.stringify(bestLogoInEnglish)}`);

            return bestLogoInEnglish ? bestLogoInEnglish.url.replace('http://', 'https://') : '';
        }

        const bestLogoUrl = bestLogoInPreferredLang.url.replace('http://', 'https://');
        log.debug(`Best logo URL: ${bestLogoUrl}`);
        return bestLogoUrl;
    } catch (error) {
        log.error(`Error fetching logos from Fanart.tv for TMDB ID ${tmdbId}:`, error.message);
        return '';
    }
};

module.exports = { getFanartLogo };
