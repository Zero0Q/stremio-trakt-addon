const express = require('express');
const { saveUserTokens, fetchUserWatchedMovies, fetchUserWatchedShows, fetchUserTokens } = require('../helpers/trakt');
const { fetchUserProfile, exchangeCodeForToken, markContentAsWatched, saveUserWatchedHistory, lookupTraktId, fetchTrendingLists, fetchPopularLists, searchLists, fetchListById } = require('../api/trakt');
const log = require('../helpers/logger');
const router = express.Router();

const { TRAKT_CLIENT_ID } = process.env;

if (!TRAKT_CLIENT_ID) {
  log.warn('Environment variables TRAKT_CLIENT_ID is not set.');
}

router.get('/callback', async (req, res) => {
  const code = req.query.code;

  if (!code) {
    log.error('Authorization code is missing.');
    return res.status(400).send('Error: Authorization code is missing.');
  }

  try {
    const { access_token, refresh_token } = await exchangeCodeForToken(code);

    if (!access_token || !refresh_token) {
      log.error('Received tokens are invalid or missing.');
      return res.status(500).send('Error receiving tokens.');
    }

    const userProfile = await fetchUserProfile(access_token);
    const username = userProfile.username;

    if (!username) {
      log.error('Received username is invalid or missing.');
      return res.status(500).send('Error receiving username.');
    }

    const now = new Date();

    await saveUserTokens(username, access_token, refresh_token);
    log.info(`Successfully saved tokens and username for user ${username}.`);

    const [movieHistory, showHistory] = await Promise.all([
      fetchUserWatchedMovies(username, access_token),
      fetchUserWatchedShows(username, access_token)
    ]);

    log.info(`Successfully fetched watched movies and shows for user ${username}.`);

    await Promise.all([
      saveUserWatchedHistory(username, movieHistory),
      saveUserWatchedHistory(username, showHistory)
    ]);

    log.info(`Successfully saved watched history for user ${username} in the database.`);

    res.redirect(`/configure?username=${encodeURIComponent(username)}`);
  } catch (error) {
    log.error(`Error during token exchange: ${error.response ? error.response.data : error.message}`);
    res.status(500).send('Error connecting to Trakt');
  }
});

router.get('/lists/trending', async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  try {
      const trendingLists = await fetchTrendingLists(page, limit);
      res.json(trendingLists);
  } catch (error) {
      log.error(`Error fetching trending lists: ${error.message}`);
      res.status(500).send('Error fetching trending lists');
  }
});

router.get('/lists/popular', async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  try {
      const popularLists = await fetchPopularLists(page, limit);
      res.json(popularLists);
  } catch (error) {
      log.error(`Error fetching popular lists: ${error.message}`);
      res.status(500).send('Error fetching popular lists');
  }
});

router.get('/lists/search', async (req, res) => {
  const { query, page = 1, limit = 10 } = req.query;

  if (!query) {
    return res.status(400).send('Query parameter is required');
  }

  try {
    const searchResults = await searchLists(query, page, limit);
    res.json(searchResults);
  } catch (error) {
    log.error(`Error searching for lists: ${error.message}`);
    res.status(500).send('Error searching for lists');
  }
});

router.get('/lists/:id', async (req, res) => {
  const { id } = req.params;

  try {
      const listData = await fetchListById(id);
      res.json(listData);
  } catch (error) {
      log.error(`Error fetching list with ID ${id}: ${error.message}`);
      res.status(500).send('Error fetching list');
  }
});

module.exports = router;
