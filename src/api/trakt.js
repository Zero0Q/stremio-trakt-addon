const axios = require('axios');
const { pool } = require('../helpers/db');
const log = require('../helpers/logger');
const { addToQueueGET, addToQueuePOST } = require('../helpers/bottleneck_trakt');
const { safeRedisCall } = require('../helpers/redis');
const { parseCacheDuration } = require('../helpers/cache');

const TRAKT_BASE_URL = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';
const TRAKT_API_KEY = process.env.TRAKT_CLIENT_ID;
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const TRAKT_REDIRECT_URI = `${process.env.BASE_URL}/callback`;

/**
 * Makes an API GET request to the specified URL and caches the result.
 * @example
 * getTraktData('https://api.trakt.tv/shows/popular', 'your_access_token')
 * // Returns a promise resolving to the data obtained from the URL
 * @param {string} url - The URL to make the GET request to.
 * @param {string|null} accessToken - Optional access token for authenticated requests.
 * @returns {Promise<Object>} A promise that resolves to the data retrieved from the API, either from cache or directly from the API call.
 * @description
 *   - Utilizes a caching mechanism to reduce redundant API requests by storing results in Redis.
 *   - Handles both authenticated and unauthenticated requests based on the presence of an access token.
 *   - Utilizes an external queue system to manage the rate of API requests.
 *   - Logs request outcomes and potential errors for debugging purposes.
 */
const makeGetRequest = (url, accessToken = null) => {
    const headers = {
        'trakt-api-version': TRAKT_API_VERSION,
        'trakt-api-key': TRAKT_API_KEY,
    };

    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    } else {
        log.debug(`No access token provided, making unauthenticated request.`);
    }

    const cacheKey = `trakt:GET:${accessToken || 'public'}:${url}`;

    return new Promise(async (resolve, reject) => {
        const cachedData = await safeRedisCall('get', cacheKey);
        if (cachedData) {
            log.debug(`Cache hit for URL: ${url}`);
            return resolve(JSON.parse(cachedData));
        }

        addToQueueGET({
            fn: () => axios.get(url, { headers })
                .then(async (response) => {
                    log.debug(`API GET request successful for URL: ${url}`);

                    const cacheDuration = parseCacheDuration(process.env.TRAKT_CACHE_DURATION || '1d');
                    await safeRedisCall('set', cacheKey, JSON.stringify(response.data), 'EX', cacheDuration);

                    resolve(response.data);
                })
                .catch(error => {
                    if (error.response && error.response.status === 401) {
                        log.warn(`Unauthorized request (401) during API GET request for URL: ${url} - ${error.message}`);
                    } else {
                        log.error(`Error during API GET request for URL: ${url} - ${error.message}`);
                    }
                    reject(error);
                })
        });
    });
};

/**
* Makes a POST request to the specified URL with optional caching using Redis
* @example
* postToTraktAPI('https://api.trakt.tv/sync/collection', data, 'yourAccessToken')
* // Returns a Promise that resolves to the response data from the API
* @param {string} url - The URL to send the POST request to.
* @param {object} data - The data to be sent in the body of the POST request.
* @param {string|null} accessToken - Optional access token for authorization.
* @returns {Promise<object>} Promise that resolves to the response data from the API.
* @description
*   - Utilizes Redis for potential caching of response when making API calls.
*   - Adds the API call to a queue for rate limiting purposes.
*   - Caches successful POST request responses for a configurable duration.
*   - Handles authorization through optional access token if provided.
*/
const makePostRequest = (url, data, accessToken = null) => {
    const headers = {
        'trakt-api-version': TRAKT_API_VERSION,
        'trakt-api-key': TRAKT_API_KEY,
        'Content-Type': 'application/json',
    };

    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    const cacheKey = `trakt:POST:${accessToken || 'public'}:${url}:${JSON.stringify(data)}`;

    return new Promise(async (resolve, reject) => {
        const cachedData = await safeRedisCall('get', cacheKey);
        if (cachedData) {
            log.debug(`Cache hit for POST URL: ${url}`);
            return resolve(JSON.parse(cachedData));
        }

        addToQueuePOST({
            fn: () => axios.post(url, data, { headers })
                .then(async (response) => {
                    log.debug(`API POST request successful for URL: ${url}`);

                    const cacheDuration = parseCacheDuration(process.env.TRAKT_CACHE_DURATION || '1d');
                    await safeRedisCall('set', cacheKey, JSON.stringify(response.data), 'EX', cacheDuration);

                    resolve(response.data);
                })
                .catch(error => {
                    log.error(`Error during API POST request for URL: ${url} - ${error.message}`);
                    reject(error);
                })
        });
    });
};

/**
* Exchanges an authorization code for an access token from the Trakt API.
* @example
* sync('sample_auth_code')
* { access_token: 'xyz123', ... }
* @param {string} code - The authorization code to be exchanged for an access token.
* @returns {Promise<object>} A promise that resolves to the response containing the access token and related details.
* @description
*   - Uses a POST request to interact with the Trakt API.
*   - Requires valid client credentials such as client_id and client_secret.
*   - Handles errors by logging them and rethrowing to manage in higher-level logic or handlers.
*/
const exchangeCodeForToken = async (code) => {
    try {
        const response = await makePostRequest(`${TRAKT_BASE_URL}/oauth/token`, {
            code: code,
            client_id: TRAKT_API_KEY,
            client_secret: TRAKT_CLIENT_SECRET,
            redirect_uri: TRAKT_REDIRECT_URI,
            grant_type: 'authorization_code',
        });

        return response;
    } catch (error) {
        log.error(`Error exchanging authorization code for token: ${error.message}`);
        throw error;
    }
};

/**
* Synchronously sends a GET request to the specified endpoint and retrieves data.
* @example
* sync('/movies/popular', { limit: 10 }, 'yourAccessToken')
* Promise resolving to an array of popular movies
* @param {string} endpoint - The API endpoint to send the request to.
* @param {Object} [params={}] - Query parameters to include in the request.
* @param {string|null} [accessToken=null] - OAuth access token for authentication.
* @returns {Promise<Object>} A promise resolving to the data retrieved from the endpoint.
* @description
*   - Builds a request URL by appending the given endpoint and query parameters to the TRAKT_BASE_URL.
*   - Utilizes an internal function 'makeGetRequest' to perform the HTTP request.
*   - Logs the success message upon successful data retrieval.
*   - Propagates any errors encountered during the request process.
*/
const fetchData = async (endpoint, params = {}, accessToken = null) => {
    const queryString = new URLSearchParams(params).toString();
    const url = `${TRAKT_BASE_URL}${endpoint}?${queryString}`;

    try {
        const data = await makeGetRequest(url, accessToken);
        log.debug(`Data successfully retrieved from URL: ${url}`);
        return data;
    } catch (error) {
        throw error;
    }
};

/**
* Refreshes the authentication token using the provided refresh token.
* @example
* sync('your_refresh_token')
* // returns response data from the token refresh request
* @param {string} refreshToken - The refresh token to request a new access token.
* @returns {Promise<object>} The response data from the token refresh request.
* @description
*   - Uses Trakt API endpoint to exchange the refresh token for a new access token.
*   - Handles errors by logging them and rethrowing for further handling.
*   - Logs a debug message upon successful token refresh.
*/
const refreshTraktToken = async (refreshToken) => {
    const payload = {
        refresh_token: refreshToken,
        client_id: TRAKT_API_KEY,
        client_secret: TRAKT_CLIENT_SECRET,
        redirect_uri: TRAKT_REDIRECT_URI,
        grant_type: 'refresh_token'
    };

    try {
        const data = await makePostRequest('https://api.trakt.tv/oauth/token', payload);
        log.debug('Token refreshed successfully');
        return data;
    } catch (error) {
        if (error.response) {
            log.error(`Failed to refresh token: ${JSON.stringify(error.response.data)}`);
        } else {
            log.error(`Failed to refresh token: ${error.message}`);
        }
        throw error;
    }
};

const updateTokensInDb = async (username, newAccessToken, newRefreshToken) => {
    await pool.query(
        'UPDATE trakt_tokens SET access_token = $1, refresh_token = $2 WHERE username = $3',
        [newAccessToken, newRefreshToken, username]
    );
};

/**
 * Fetches watched items for a specific user and type from the Trakt API.
 * @example
 * sync('john_doe', 'movies', 'abc123')
 * Promise resolving to the list of watched movies
 * @param {string} username - The Trakt username whose watched items are to be retrieved.
 * @param {string} type - The content type to fetch (e.g., 'movies', 'shows').
 * @param {string} accessToken - The access token for authenticating with the Trakt API.
 * @returns {Promise<any>} A promise that resolves with the data from the API or rejects with an error.
 * @description
 *   - Authenticates the request using the provided access token.
 *   - Throws 'token_expired' error if the access token has expired.
 */
const fetchUserHistory = async (username, type, accessToken) => {
    const endpoint = `/users/${username}/watched/${type}`;

    try {
        return await fetchData(endpoint, {}, accessToken);
    } catch (error) {
        if (error.response && error.response.status === 401) {
            throw new Error('token_expired');
        } else {
            throw error;
        }
    }
};

/**
 * Handles updating Trakt history and marks watched content.
 * @example
 * handleTraktHistory(parsedConfig, filteredResults, 'movies')
 * // Returns processed results with watched indications
 * @param {Object} parsedConfig - Configuration object containing Trakt username and optional watched emoji.
 * @param {Array} filteredResults - Array of filtered content results to be processed.
 * @param {string} type - Type of content to handle ('movies' or 'series').
 * @returns {Array} Processed content results with watched indications when applicable.
 * @description
 *   - Fetches user's Trakt history if the last fetch was outside the configured interval.
 *   - Updates the Trakt tokens if they are expired during fetching.
 *   - Marks content with a specific emoji if it exists in the user's Trakt history.
 */
async function handleTraktHistory(parsedConfig, filteredResults, type) {
    const traktUsername = parsedConfig.traktUsername;
    const watchedEmoji = parsedConfig.watchedEmoji || '✔️';
    const fetchInterval = process.env.TRAKT_HISTORY_FETCH_INTERVAL || '24h';

    const dbType = type === 'movies' ? 'movie' : type === 'series' ? 'show' : type;

    const intervalInMs = (() => {
        const intervalValue = parseInt(fetchInterval.slice(0, -1), 10);
        const intervalUnit = fetchInterval.slice(-1);

        switch (intervalUnit) {
            case 'h':
                return intervalValue * 60 * 60 * 1000;
            case 'd':
                return intervalValue * 24 * 60 * 60 * 1000;
            default:
                throw new Error(`Invalid time unit in TRAKT_HISTORY_FETCH_INTERVAL: ${fetchInterval}`);
        }
    })();

    const result = await pool.query(
        `SELECT last_fetched_at FROM trakt_tokens WHERE username = $1`,
        [traktUsername]
    );

    const lastFetchedRow = result.rows[0];
    const lastFetchedAt = lastFetchedRow ? new Date(lastFetchedRow.last_fetched_at) : null;
    const now = new Date();

    if (!lastFetchedAt || (now - lastFetchedAt) >= intervalInMs) {
        try {
            const tokensResult = await pool.query(
                `SELECT access_token, refresh_token FROM trakt_tokens WHERE username = $1`,
                [traktUsername]
            );

            const tokensRow = tokensResult.rows[0];
            if (tokensRow) {
                let { access_token, refresh_token } = tokensRow;

                try {
                    const [movieHistory, showHistory] = await Promise.all([
                        fetchUserHistory(traktUsername, 'movies', access_token),
                        fetchUserHistory(traktUsername, 'shows', access_token)
                    ]);

                    await Promise.all([
                        saveUserWatchedHistory(traktUsername, movieHistory),
                        saveUserWatchedHistory(traktUsername, showHistory)
                    ]);
                } catch (error) {
                    if (error.message === 'token_expired') {
                        log.warn(`Token expired for user ${traktUsername}, refreshing token...`);

                        const newTokens = await refreshTraktToken(refresh_token);
                        access_token = newTokens.access_token;
                        refresh_token = newTokens.refresh_token;

                        await updateTokensInDb(traktUsername, newTokens.access_token, newTokens.refresh_token);

                        const [movieHistory, showHistory] = await Promise.all([
                            fetchUserHistory(traktUsername, 'movies', newTokens.access_token),
                            fetchUserHistory(traktUsername, 'shows', newTokens.access_token)
                        ]);

                        await Promise.all([
                            saveUserWatchedHistory(traktUsername, movieHistory),
                            saveUserWatchedHistory(traktUsername, showHistory)
                        ]);
                    } else {
                        throw error;
                    }
                }

                await pool.query(
                    `UPDATE trakt_tokens SET last_fetched_at = $1 WHERE username = $2`,
                    [now.toISOString(), traktUsername]
                );
            }
        } catch (error) {
            log.error(`Error fetching Trakt history for user ${traktUsername}: ${error.message}`);
        }
    }

    const traktIdsResult = await pool.query(
        `SELECT imdb_id FROM trakt_history WHERE username = $1 AND type = $2 AND imdb_id IS NOT NULL`,
        [traktUsername, dbType]
    );

    log.debug(`Fetching Trakt history for user ${traktUsername} with type ${dbType}. Result: ${traktIdsResult.rows.length} items found.`);
    const traktIds = traktIdsResult.rows.map(row => `${row.imdb_id}`);

    return filteredResults.map(content => {
        const contentId = `${content.id}`;
        if (traktIds.includes(contentId)) {
            content.name = `${watchedEmoji} ${content.name || content.title}`;
        }
        return content;
    });
}

/**
 * Save the user's viewing history to the database
 * @example
 * sync('john_doe', [{ movie: { ids: { imdb: 'tt1234567', tmdb: '123456' }, title: 'Movie Title' }, last_watched_at: '2023-10-01' }])
 * // Saves or updates history for 'john_doe' based on provided records
 * @param {string} username - The username of the user whose history is being updated.
 * @param {Array} history - An array containing the viewing history records, each with movie or show details.
 * @returns {void} No value is returned.
 * @description
 *   - Records or updates user's viewing history in a PostgreSQL database.
 *   - Starts a database transaction to ensure data consistency.
 *   - After attempting to save or update all records, it either commits the transaction or rolls back in case of an error.
 */
const saveUserWatchedHistory = async (username, history) => {
    if (!history || history.length === 0) {
        log.warn(`No history to save for user ${username}.`);
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const item of history) {
            const media = item.movie || item.show;
            const mediaId = media.ids.imdb || media.ids.tmdb;
            const mediaType = item.movie ? 'movie' : 'show';
            const watchedAt = item.last_watched_at;
            const title = media.title;

            const historyResult = await client.query(
                `SELECT id FROM trakt_history WHERE username = $1 AND imdb_id = $2`,
                [username, media.ids.imdb]
            );

            if (historyResult.rows.length > 0) {
                await client.query(
                    `UPDATE trakt_history
                     SET watched_at = $1, title = $2, tmdb_id = $3, type = $4
                     WHERE id = $5`,
                    [watchedAt, title, media.ids.tmdb, mediaType, historyResult.rows[0].id]
                );
            } else {
                await client.query(
                    `INSERT INTO trakt_history (username, imdb_id, tmdb_id, type, watched_at, title)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [username, media.ids.imdb, media.ids.tmdb, mediaType, watchedAt, title]
                );
            }
        }

        await client.query('COMMIT');
        log.info(`History saved for user ${username}`);
    } catch (err) {
        await client.query('ROLLBACK');
        log.error(`Error committing transaction for user ${username}: ${err.message}`);
        throw err;
    } finally {
        client.release();
    }
};

const fetchUserProfile = async (accessToken) => {
    const endpoint = '/users/me';
    return await fetchData(endpoint, {}, accessToken);
};

/**
 * Retrieves the Trakt ID associated with a given TMDB ID.
 * @example
 * lookupTraktId(12345, 'movie', 'your_access_token')
 * 67890
 * @param {number} tmdbId - The TMDB ID for which the Trakt ID is needed.
 * @param {string} type - The type of media ('movie', 'show', etc.).
 * @param {string} accessToken - The access token for authentication.
 * @returns {number} The Trakt ID corresponding to the given TMDB ID.
 * @description
 *   - Makes a GET request to the Trakt API to retrieve data.
 *   - Throws an error if no matching Trakt ID is found.
 *   - Logs an error with the message for troubleshooting in case of failure.
 */
async function lookupTraktId(tmdbId, type, accessToken) {
    const url = `${TRAKT_BASE_URL}/search/tmdb/${tmdbId}?type=${type}`;

    try {
        const response = await makeGetRequest(url, accessToken);
        if (response.length > 0 && response[0].type === type && response[0][type]) {
            const traktId = response[0][type].ids.trakt;
            return traktId;
        } else {
            throw new Error(`No Trakt ID found for TMDB ID ${tmdbId}`);
        }
    } catch (error) {
        log.error(`Error fetching Trakt ID for TMDB ID ${tmdbId}: ${error.message}`);
        throw error;
    }
}


/**
* Synchronizes watched status for movies or series with Trakt.
* @example
* sync('accessToken123', 'movies', 456, '2023-09-30T12:34:56Z')
* Promise resolving with API response data
* @param {string} access_token - The user's Trakt API access token.
* @param {string} type - Type of content, either 'movies' or 'series'.
* @param {number} id - The Trakt ID of the movie or series.
* @param {string} watched_at - The ISO 8601 formatted date-time string when the movie or episode was watched.
* @returns {Promise<Object>} The response object from the Trakt API.
* @description
*   - Captures errors during the API request and logs them before rethrowing.
*   - The function builds the request payload based on whether the type is 'movies' or 'series'.
*   - Uses `makePostRequest` to communicate with the Trakt API for syncing.
*/
const markContentAsWatched = async (access_token, type, id, watched_at) => {
    const url = `${TRAKT_BASE_URL}/sync/history`;
  
    let data = {};
    if (type === 'movies') {
      data = {
        movies: [{ ids: { trakt: id }, watched_at }]
      };
    } else if (type === 'series') {
      data = {
        shows: [{ ids: { trakt: id }, watched_at }]
      };
    }
  
    try {
      const response = await makePostRequest(url, data, access_token);
      return response;
    } catch (error) {
      log.error(`Error marking content as watched: ${error.message}`);
      throw error;
    }
  };

  const fetchTrendingLists = async (page = 1, limit = 10, accessToken = null) => {
    const endpoint = `/lists/trending?page=${page}&limit=${limit}`;
    const response = await fetchData(endpoint, {}, accessToken);
    return response;
};


const fetchPopularLists = async (page = 1, limit = 10, accessToken = null) => {
    const endpoint = `/lists/popular?page=${page}&limit=${limit}`;
    return await fetchData(endpoint, {}, accessToken);
};

const searchLists = async (query, page = 1, limit = 10, accessToken = null) => {
    const endpoint = `/search/list?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;
    return await fetchData(endpoint, {}, accessToken);
};

const fetchListById = async (listId, accessToken = null) => {
    const endpoint = `/lists/${listId}`;
    return await fetchData(endpoint, {}, accessToken);
};

/**
 * Fetches and optionally sorts list items from the Trakt API.
 * @example
 * sync('12345', 'movies')
 * [ { title: 'Movie A', year: 2021 }, { title: 'Movie B', year: 2020 } ]
 * @param {string} listId - The identifier of the list to fetch items from.
 * @param {string} type - The type of items to fetch (e.g., 'movies', 'shows').
 * @param {number} [page=1] - The page of results to fetch.
 * @param {number} [limit=20] - The number of items per page.
 * @param {string|null} [sortBy=null] - The field by which results should be sorted (e.g., 'rank', 'listed_at').
 * @param {string} [sortHow='asc'] - The direction to sort the results ('asc' or 'desc').
 * @param {string|null} [accessToken=null] - The access token for authenticating the API request.
 * @returns {Array<Object>} The data fetched from Trakt API, sorted if a sort field is specified.
 * @description
 *   - The function will fetch data from the Trakt API, supporting pagination and optional sorting.
 *   - Sorting is performed only if a valid `sortBy` argument is provided.
 *   - It logs debug information about the API request and response process.
 *   - The function throws an error if the API request fails.
 */
const fetchListItems = async (listId, type, page = 1, limit = 20, sortBy = null, sortHow = 'asc', accessToken = null) => {
    const endpoint = `/lists/${listId}/items/movies,shows`;

    let params = {};
    if (!sortBy) {
        params = { page, limit };
    }

    log.debug(`Fetching list items from Trakt API with listId: ${listId}, type: ${type}, page: ${page}, limit: ${limit}, sortBy: ${sortBy}, sortHow: ${sortHow}`);

    try {
        const data = await fetchData(endpoint, params, accessToken);

        log.debug(`Data successfully retrieved from Trakt API: ${endpoint}`);

        if (sortBy) {
            data.sort((a, b) => {
                let valueA, valueB;

                switch (sortBy) {
                    case 'rank':
                        valueA = a.rank;
                        valueB = b.rank;
                        break;
                    case 'listed_at':
                        valueA = new Date(a.listed_at);
                        valueB = new Date(b.listed_at);
                        break;
                    case 'title':
                        valueA = (a.movie?.title || a.show?.title || '').toLowerCase();
                        valueB = (b.movie?.title || b.show?.title || '').toLowerCase();
                        break;
                    case 'year':
                        valueA = a.movie?.year || a.show?.year || 0;
                        valueB = b.movie?.year || b.show?.year || 0;
                        break;
                    default:
                        return 0;
                }

                if (sortHow === 'desc') {
                    return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
                } else {
                    return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
                }
            });
        }

        return data;
    } catch (error) {
        log.error(`Error fetching list items from Trakt API: ${endpoint} - ${error.message}`);
        throw error;
    }
};

/**
 * Fetch trending items from the API based on the specified type and filters.
 * @example
 * sync('movie', 2, 10, 'action')
 * // returns an array of trending movies for page 2 with a limit of 10 items per page and filtered by 'action' genre
 * @param {string} type - The media type to fetch trending items for ('movie' or 'series').
 * @param {number} [page=1] - The page number of results to retrieve.
 * @param {number} [limit=20] - The number of items per page.
 * @param {string|null} [genre=null] - Optional genre filter for the results.
 * @returns {Promise<Object>} A promise resolving to the fetched trending data.
 * @description
 *   - Converts type 'movie' to 'movies' and 'series' to 'shows' for the endpoint.
 *   - Logs debug information for each API call attempt and success.
 *   - Logs error information and re-throws the error if the fetch operation fails.
 */
const fetchTrendingItems = async (type, page = 1, limit = 20, genre = null) => {
    const convertedType = type === 'movie' ? 'movies' : type === 'series' ? 'shows' : type;
    const endpoint = `/${convertedType}/trending`;
    const params = { page, limit };
    if (genre) {
        params.genres = genre;
    }

    try {
        log.debug(`Fetching trending items for type: ${type} (converted to ${convertedType}), page: ${page}, limit: ${limit}, genre: ${genre}`);
        const data = await fetchData(endpoint, params);
        log.debug(`Data successfully retrieved for trending ${convertedType}: ${endpoint}`);
        return data;
    } catch (error) {
        log.error(`Error fetching trending ${convertedType}: ${error.message}`);
        throw error;
    }
};

/**
* Fetches a list of popular films or series from the API based on the specified type, pagination, and genre.
* @example
* sync('movie', 1, 20, 'action')
* // Returns a list of popular action movies.
* @param {string} type - The type of content to fetch, either 'movie' or 'series'.
* @param {number} [page=1] - The page number for pagination.
* @param {number} [limit=20] - The number of items to fetch per page.
* @param {string|null} [genre=null] - The genre of content to filter by.
* @returns {Promise<Object>} The fetched popular items data from the API.
* @description
*   - Converts 'movie' to 'movies' and 'series' to 'shows' to match the API endpoint paths.
*   - Appends a 'genre' parameter to the request only if it is provided.
*   - Logs the request and response for debugging, and handles errors by logging and throwing them.
*/
const fetchPopularItems = async (type, page = 1, limit = 20, genre = null) => {
    const convertedType = type === 'movie' ? 'movies' : type === 'series' ? 'shows' : type;
    const endpoint = `/${convertedType}/popular`;
    const params = { page, limit };
    if (genre) {
        params.genres = genre;
    }

    try {
        log.debug(`Fetching popular items for type: ${type} (converted to ${convertedType}), page: ${page}, limit: ${limit}, genre: ${genre}`);
        const data = await fetchData(endpoint, params);
        log.debug(`Data successfully retrieved for popular ${convertedType}: ${endpoint}`);
        return data;
    } catch (error) {
        log.error(`Error fetching popular ${convertedType}: ${error.message}`);
        throw error;
    }
};

/**
* Fetches the access token for a given username.
* @example
* sync('john_doe')
* 'sample_access_token'
* @param {string} username - The username for which to retrieve the access token.
* @returns {string} The access token associated with the given username.
* @description
*   - This function interacts with a SQL database to fetch the access token.
*   - If no access token is found, it throws an error.
*   - Errors are logged before being thrown.
*/
const getAccessTokenForUser = async (username) => {
    try {
        const query = 'SELECT access_token FROM trakt_tokens WHERE username = $1';
        const result = await pool.query(query, [username]);

        if (result.rows.length === 0) {
            throw new Error(`No access token found for user ${username}`);
        }

        return result.rows[0].access_token;
    } catch (error) {
        log.error(`Error fetching access token for user ${username}: ${error.message}`);
        throw error;
    }
};

/**
* Fetch the user's watchlist from the Trakt API based on specified type, page, and limit.
* @example
* sync('john_doe', 'series', 2, 10)
* Returns a list of watchlist items for the user 'john_doe' for series type on page 2 with a limit of 10 items.
* @param {string} username - The username of the user whose watchlist is being fetched.
* @param {string} [type='movie'] - The type of watchlist to fetch, either 'movie' or 'series'. Defaults to 'movie'.
* @param {number} [page=1] - The page of the watchlist to fetch. Defaults to 1.
* @param {number} [limit=20] - The number of items to fetch per page. Defaults to 20.
* @returns {Promise<Object>} An object containing the user's watchlist data.
* @description
*   - Converts the single 'type' into plural form for the API endpoint: 'movie' becomes 'movies' and 'series' becomes 'shows'.
*   - Utilizes an access token specific to the user to authenticate the API request.
*   - Logs the operation's progress and errors to help with debugging.
*/
const fetchWatchlistItems = async (username, type = 'movie', page = 1, limit = 20) => {
    try {
        const accessToken = await getAccessTokenForUser(username);

        const convertedType = type === 'movie' ? 'movies' : type === 'series' ? 'shows' : type;
        const endpoint = `/users/${username}/watchlist/${convertedType}`;
        const params = { page, limit };

        log.debug(`Fetching watchlist items for user: ${username}, type: ${type} (converted to ${convertedType}), page: ${page}, limit: ${limit}`);

        const data = await fetchData(endpoint, params, accessToken);

        log.debug(`Data successfully retrieved for watchlist: ${endpoint}`);
        return data;
    } catch (error) {
        log.error(`Error fetching watchlist for user ${username}: ${error.message}`);
        throw error;
    }
};

/**
* Fetches recommendations based on user preferences and type
* @example
* sync('john_doe', 'movies')
* // Returns a list of recommended movies for user 'john_doe'
* @param {string} username - The username for which to fetch recommendations.
* @param {string} [type='movies'] - The type of recommendations to fetch, either 'movies' or 'series'. Default is 'movies'.
* @param {boolean} [ignoreCollected=true] - Whether to exclude already collected items from recommendations. Default is true.
* @param {boolean} [ignoreWatchlisted=true] - Whether to exclude watchlisted items from recommendations. Default is true.
* @returns {Promise<object>} The recommended items data.
* @description
*   - Converts 'movie' to 'movies' and 'series' to 'shows' to ensure compatibility with API endpoint.
*   - Uses an access token specific to the user for API authentication.
*   - Logs the recommendation fetch process for debugging purposes.
*   - Throws an error with a message if fetching fails.
*/
const fetchRecommendations = async (username, type = 'movies', ignoreCollected = true, ignoreWatchlisted = true) => {
    try {
        const accessToken = await getAccessTokenForUser(username);

        const convertedType = type === 'movie' ? 'movies' : type === 'series' ? 'shows' : type;
        const endpoint = `/recommendations/${convertedType}`;
        const params = {
            ignore_collected: ignoreCollected,
            ignore_watchlisted: ignoreWatchlisted,
            limit: 100
        };

        log.debug(`Fetching recommendations for user: ${username}, type: ${type} (converted to ${convertedType}), limit: 100`);

        const data = await fetchData(endpoint, params, accessToken);

        log.debug(`Data successfully retrieved for recommendations: ${endpoint}`);
        return data;
    } catch (error) {
        log.error(`Error fetching recommendations for user ${username}: ${error.message}`);
        throw error;
    }
};

/**
* Retrieves and returns genre data from a specified endpoint based on type
* @example
* sync('movies')
* // Returns an array of movie genres
* @param {string} type - The type of genres to fetch (e.g., 'movies', 'shows').
* @returns {Promise<object>} A promise that resolves to the genre data.
* @description
*   - Utilizes the fetchData function to request genres from a constructed endpoint.
*   - Logs the retrieval process and handles potential errors by logging them.
*   - Throws the error to be handled by the caller if genre data cannot be fetched.
*/
const fetchGenres = async (type) => {
    const endpoint = `/genres/${type}`;
  
    try {
      const genresData = await fetchData(endpoint);
      log.debug(`Genres retrieved for ${type}`);
      return genresData;
    } catch (error) {
      log.error(`Error fetching genres from Trakt: ${error.message}`);
      throw error;
    }
  };

/**
* Inserts multiple genres into the database for a specified media type
* @example
* sync([{slug: 'action', name: 'Action'}, {slug: 'comedy', name: 'Comedy'}], 'movie')
* // Commits transaction and logs success message
* @param {Array<Object>} genres - Array of genre objects, each containing slug and name.
* @param {String} mediaType - The type of media associated with the genres.
* @returns {Promise<void>} Returns a promise that resolves when operation is complete.
* @description
*   - Begins a transaction before inserting genres and commits upon success.
*   - Rolls back the transaction in case of an error and logs the error message.
*   - Uses a connection pool to manage database connections efficiently.
*/
const storeGenresInDb = async (genres, mediaType) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
  
        const insertGenreText = `
            INSERT INTO genres (genre_slug, genre_name, media_type)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
        `;
      
        for (const genre of genres) {
            await client.query(insertGenreText, [genre.slug, genre.name, mediaType]);
        }
  
        await client.query('COMMIT');
        log.info(`Genres stored for ${mediaType}`);
    } catch (err) {
        await client.query('ROLLBACK');
        log.error(`Error inserting genre: ${err.message}`);
        throw err;
    } finally {
        client.release();
    }
};

/**
* Fetches movie and show genres from an external source and stores them in a database
* @example
* sync()
* undefined
* @param {None} - No parameters are passed to this function.
* @returns {Promise<void>} Promise that resolves when genres are fetched and stored.
* @description
*   - Fetches genres specifically for movies and shows.
*   - Stores the fetched genres into a database, categorizing them as 'movie' or 'series'.
*   - Logs information and error messages accordingly.
*/
const fetchAndStoreGenres = async () => {
    try {
        const movieGenres = await fetchGenres('movies');
        const showGenres = await fetchGenres('shows');
  
        await storeGenresInDb(movieGenres, 'movie');
        await storeGenresInDb(showGenres, 'series');

        log.info(`Genres fetched and stored`);
    } catch (error) {
        log.error(`Error fetching/storing genres: ${error.message}`);
    }
};

module.exports = { makeGetRequest, makePostRequest, fetchUserHistory, fetchUserProfile, exchangeCodeForToken, handleTraktHistory, markContentAsWatched, lookupTraktId, saveUserWatchedHistory, fetchTrendingLists, fetchPopularLists, searchLists, fetchListById, fetchListItems, fetchTrendingItems, fetchPopularItems, fetchWatchlistItems, fetchRecommendations, fetchAndStoreGenres };
