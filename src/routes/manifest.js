const express = require('express');
const log = require('../helpers/logger');
const { pool } = require('../helpers/db');
const { fetchAndStoreGenres } = require('../api/trakt');

const getGenres = async (type) => {
    try {
        const result = await pool.query(
            "SELECT genre_name FROM genres WHERE media_type = $1", 
            [type]
        );
        return result.rows.map(row => row.genre_name);
    } catch (err) {
        throw err;
    }
};
  
const router = express.Router();

router.get("/:configParameters?/manifest.json", async (req, res) => {
    const { configParameters } = req.params;

    let config = {};

    try {
        if (configParameters) {
            const decodedConfig = decodeURIComponent(configParameters);
            config = JSON.parse(decodedConfig);
        }

        if (!(await pool.query("SELECT 1 FROM genres LIMIT 1")).rows.length) {
            log.debug(`Fetching genres`);
            await fetchAndStoreGenres();
        }

        const movieGenres = await getGenres('movie');
        const seriesGenres = await getGenres('series');

        const manifest = {
            "id": "com.stremio.stremiotraktaddon",
            "version": "0.3.0",
            "name": "Trakt Addon",
            "description": "Addon that generates dynamic catalogs based on Trakt lists & catalogs in your language.",
            "resources": [ "catalog" ],
            "types": [
                "movie",
                "series"
            ],
            "catalogs": [],
            "idPrefixes": ["tt"],
            "behaviorHints": {
                "configurable": true,
                "configurationRequired": false
            }
        };

        const createCatalog = (type, id, name, genres = [], addSortingOptions = false) => ({
            type,
            id,
            name,
            "extra": [
                ...(genres.length ? [{ name: 'genre', isRequired: false, options: genres }] : []),
                { name: "skip", isRequired: false },
                ...(addSortingOptions ? [
                    {
                        name: 'sortBy',
                        isRequired: false,
                        options: [
                            'rank_asc', 'rank_desc',
                            'listed_at_asc', 'listed_at_desc',
                            'title_asc', 'title_desc',
                            'year_asc', 'year_desc'
                        ]
                    }
                ] : [])
            ]
        });

        if (config.traktLists && Array.isArray(config.traktLists)) {
            config.traktLists.forEach(list => {
                manifest.catalogs.push(createCatalog('list', `trakt_${list.id}`, list.name, [], true));
            });
        }

        const toggles = config.toggles || {};

        if (toggles.watchlist) {
            manifest.catalogs.push(
                createCatalog('movie', 'watchlist_movies', 'Watchlist Movies', movieGenres),
                createCatalog('series', 'watchlist_series', 'Watchlist Series', seriesGenres)
            );
        }

        if (toggles.recommendations) {
            manifest.catalogs.push(
                createCatalog('movie', 'recommendations_movies', 'Recommended Movies', movieGenres),
                createCatalog('series', 'recommendations_series', 'Recommended Series', seriesGenres)
            );
        }

        if (toggles.trending) {
            manifest.catalogs.push(
                createCatalog('movie', 'trending_movies', 'Trending Movies', movieGenres),
                createCatalog('series', 'trending_series', 'Trending Series', seriesGenres)
            );
        }

        if (toggles.popular) {
            manifest.catalogs.push(
                createCatalog('movie', 'popular_movies', 'Popular Movies', movieGenres),
                createCatalog('series', 'popular_series', 'Popular Series', seriesGenres)
            );
        }

        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(manifest);
    } catch (error) {
        log.error('Error in /manifest.json route:', error);
        return res.status(500).json({ error: "Invalid configParameters or server error." });
    }
});

module.exports = router;
