const Parser = require("rss-parser");

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "rss-to-x-bot/1.0"
  }
});

async function fetchFeed(sourceUrl) {
  if (!sourceUrl) {
    throw new Error("Missing RSS_SOURCE_URL environment variable.");
  }

  const feed = await parser.parseURL(sourceUrl);

  if (!feed || !Array.isArray(feed.items)) {
    throw new Error("Failed to parse source feed items.");
  }

  return feed;
}

module.exports = {
  fetchFeed
};
