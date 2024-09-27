const express = require('express');
const log = require('../helpers/logger');

const router = express.Router();

router.get("/:configParameters?/manifest.json", async (req, res) => {
    const { configParameters } = req.params;

    let config = {};

    try {
        if (configParameters) {
            const decodedConfig = decodeURIComponent(configParameters);
            config = JSON.parse(decodedConfig);
        }

        const manifest = {
            "id": "com.stremio.stremiotraktaddon",
            "version": "0.1.0",
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

        if (config.traktLists && Array.isArray(config.traktLists)) {
            config.traktLists.forEach(list => {
                manifest.catalogs.push({
                    "type": "list",
                    "id": `trakt_${list.id}`,
                    "name": list.name,
                    "extra": [
                        { name: "skip", isRequired: false }
                    ]
                });
            });
        }

        const toggles = config.toggles || {};
        
        if (toggles.watchlist) {
            manifest.catalogs.push(
                { 
                    type: 'movie', 
                    id: 'watchlist_movies', 
                    name: 'Watchlist Movies',
                    extra: [{ name: "skip", isRequired: false }]
                },
                { 
                    type: 'series', 
                    id: 'watchlist_series', 
                    name: 'Watchlist Series',
                    extra: [{ name: "skip", isRequired: false }]
                }
            );
        }

        if (toggles.recommendations) {
            manifest.catalogs.push(
                { 
                    type: 'movie', 
                    id: 'recommendations_movies', 
                    name: 'Recommended Movies',
                    extra: [{ name: "skip", isRequired: false }]
                },
                { 
                    type: 'series', 
                    id: 'recommendations_series', 
                    name: 'Recommended Series',
                    extra: [{ name: "skip", isRequired: false }]
                }
            );
        }

        if (toggles.trending) {
            manifest.catalogs.push(
                { 
                    type: 'movie', 
                    id: 'trending_movies', 
                    name: 'Trending Movies',
                    extra: [{ name: "skip", isRequired: false }]
                },
                { 
                    type: 'series', 
                    id: 'trending_series', 
                    name: 'Trending Series',
                    extra: [{ name: "skip", isRequired: false }]
                }
            );
        }

        if (toggles.popular) {
            manifest.catalogs.push(
                { 
                    type: 'movie', 
                    id: 'popular_movies', 
                    name: 'Popular Movies',
                    extra: [{ name: "skip", isRequired: false }]
                },
                { 
                    type: 'series', 
                    id: 'popular_series', 
                    name: 'Popular Series',
                    extra: [{ name: "skip", isRequired: false }]
                }
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
