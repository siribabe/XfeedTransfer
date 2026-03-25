const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { fetchFeed } = require("./fetch-feed");
const { fetchArticleContent } = require("./extract-article");
const { generateXPost, resolveLlmApiUrl } = require("./generate-x-post");
const { transformItem, transformXPostItem, getSourceId } = require("./transform-post");
const { buildRssXml } = require("./build-rss");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "sent-items.json");
const SOURCE_FEED_FILE = path.join(ROOT_DIR, "public", "feed.xml");
const X_FEED_FILE = path.join(ROOT_DIR, "public", "x-feed.xml");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function loadState() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      version: 1,
      lastBuildAt: null,
      seenSourceIds: [],
      publishedItems: []
    };
  }

  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();

  if (!raw) {
    return {
      version: 1,
      lastBuildAt: null,
      seenSourceIds: [],
      publishedItems: []
    };
  }

  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return {
      version: 1,
      lastBuildAt: null,
      seenSourceIds: parsed,
      publishedItems: []
    };
  }

  return {
    version: 1,
    lastBuildAt: parsed.lastBuildAt || null,
    seenSourceIds: Array.isArray(parsed.seenSourceIds) ? parsed.seenSourceIds : [],
    publishedItems: Array.isArray(parsed.publishedItems) ? parsed.publishedItems : []
  };
}

function saveState(state) {
  ensureDir(DATA_FILE);
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function saveFile(filePath, contents) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, contents, "utf8");
}

function uniqueBy(items, keyFn) {
  const seen = new Set();

  return items.filter((item) => {
    const key = keyFn(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortByPubDateDesc(items) {
  return [...items].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
}

function defaultXFeedLink(feedLink) {
  const value = String(feedLink || "").trim();

  if (!value) {
    return "https://example.com/x-feed.xml";
  }

  if (value.endsWith("/feed.xml")) {
    return `${value.slice(0, -"/feed.xml".length)}/x-feed.xml`;
  }

  if (value.endsWith(".xml")) {
    return value.replace(/\.xml$/i, "-x.xml");
  }

  return `${value.replace(/\/+$/, "")}/x-feed.xml`;
}

function extractDescriptionField(description, label) {
  const match = String(description || "").match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function hasStoredArticleContent(item) {
  return String(item?.contentEncoded || "").trim().length >= 200;
}

function hasGeneratedPostContent(item) {
  return String(item?.generatedPostText || "").trim().length >= 20;
}

function normalizeStoredItem(item) {
  const description = String(item?.description || "");
  const originalTitle = item?.originalTitle || extractDescriptionField(description, "Original title") || item?.title || "";
  const summary = item?.summary || item?.articleExcerpt || extractDescriptionField(description, "Summary") || "";
  const articleText = item?.articleText || item?.contentEncoded || "";

  return {
    ...item,
    originalTitle,
    summary,
    articleExcerpt: item?.articleExcerpt || summary,
    articleText
  };
}

async function enrichPublishedItem(item, config) {
  const normalizedItem = normalizeStoredItem(item);

  if (!config.fetchArticleContent || hasStoredArticleContent(normalizedItem) || !normalizedItem.link) {
    return { item: normalizedItem, backfilled: false };
  }

  const articleData = await fetchArticleContent(normalizedItem.link, config);

  if (!articleData.extractedFromSource || !articleData.articleText) {
    return { item: normalizedItem, backfilled: false };
  }

  const originalTitle = normalizedItem.originalTitle || normalizedItem.title;
  const existingSummary = normalizedItem.summary;
  const freshSummary = articleData.articleExcerpt || existingSummary;
  const descriptionParts = [
    originalTitle ? `Original title: ${originalTitle}` : "",
    freshSummary ? `Summary: ${freshSummary}` : "",
    articleData.articleText ? `Article text: ${articleData.articleText}` : "",
    normalizedItem.link ? `Source: ${normalizedItem.link}` : ""
  ].filter(Boolean);

  return {
    item: {
      ...normalizedItem,
      description: descriptionParts.join("\n"),
      contentEncoded: articleData.articleText,
      articleExcerpt: freshSummary,
      articleText: articleData.articleText,
      originalTitle
    },
    backfilled: true
  };
}

async function generateStoredXPost(item, config) {
  const normalizedItem = normalizeStoredItem(item);
  const llmReady = Boolean(
    config.enableLlmPostGeneration && config.llmApiKey && config.llmModel
  );
  const shouldUpgradeFallbackToLlm = Boolean(
    hasGeneratedPostContent(normalizedItem) &&
      !normalizedItem.generatedPostUsedLlm &&
      llmReady
  );

  if (
    hasGeneratedPostContent(normalizedItem) &&
    !config.forceRegenerateXPosts &&
    !shouldUpgradeFallbackToLlm
  ) {
    return { item: normalizedItem, generated: false };
  }

  const generated = await generateXPost(normalizedItem, config);

  return {
    item: {
      ...normalizedItem,
      generatedPostText: generated.postText,
      generatedPostUsedLlm: generated.usedLlm,
      generatedPostMethod: generated.generationMethod,
      generatedPostModel: generated.model || "",
      generatedPostError: generated.error || ""
    },
    generated: true,
    usedLlm: generated.usedLlm
  };
}

async function main() {
  const config = {
    sourceUrl: process.env.RSS_SOURCE_URL,
    feedTitle: process.env.FEED_TITLE || "X Feed Transfer Source Feed",
    feedLink: process.env.FEED_LINK || "https://example.com/feed.xml",
    feedDescription: process.env.FEED_DESCRIPTION || "Inspection feed with source articles and extracted body text",
    xFeedTitle: process.env.X_FEED_TITLE || "X Feed Transfer Generated Posts",
    xFeedLink: process.env.X_FEED_LINK || defaultXFeedLink(process.env.FEED_LINK || "https://example.com/feed.xml"),
    xFeedDescription: process.env.X_FEED_DESCRIPTION || "Generated X-ready posts produced from source articles",
    postPrefix: process.env.POST_PREFIX || "",
    postSuffix: process.env.POST_SUFFIX || "",
    postMaxLength: parseNumber(process.env.POST_MAX_LENGTH, 260),
    xPostPrefix: process.env.X_POST_PREFIX || "",
    xPostSuffix: process.env.X_POST_SUFFIX || "",
    xPostMaxLength: parseNumber(process.env.X_POST_MAX_LENGTH, 260),
    xPostStyle: (process.env.X_POST_STYLE || "").trim(),
    maxXFeedItems: parseNumber(process.env.MAX_X_FEED_ITEMS, 3),
    maxNewItems: parseNumber(process.env.MAX_NEW_ITEMS, 3),
    maxFeedItems: parseNumber(process.env.MAX_FEED_ITEMS, 30),
    fetchArticleContent: parseBoolean(process.env.FETCH_ARTICLE_CONTENT, true),
    articleMaxChars: parseNumber(process.env.ARTICLE_MAX_CHARS, 12000),
    fetchTimeoutMs: parseNumber(process.env.FETCH_TIMEOUT_MS, 15000),
    enableLlmPostGeneration: parseBoolean(process.env.ENABLE_LLM_POST_GENERATION, true),
    forceRegenerateXPosts: parseBoolean(process.env.FORCE_REGENERATE_X_POSTS, false),
    llmApiUrl: process.env.LLM_API_URL ? resolveLlmApiUrl(process.env.LLM_API_URL) : "",
    llmApiKey: process.env.LLM_API_KEY || "",
    llmModel: process.env.LLM_MODEL || "",
    llmSystemPrompt: process.env.LLM_SYSTEM_PROMPT || "",
    llmUserPromptTemplate: process.env.LLM_USER_PROMPT_TEMPLATE || "",
    llmTemperature: parseFloatNumber(process.env.LLM_TEMPERATURE, 0.4),
    llmMaxTokens: parseNumber(process.env.LLM_MAX_TOKENS, 650),
    llmTimeoutMs: parseNumber(process.env.LLM_TIMEOUT_MS, 30000)
  };

  if (config.enableLlmPostGeneration && config.llmApiKey && config.llmModel) {
    const effectiveUrl = config.llmApiUrl || resolveLlmApiUrl("");
    console.log(`LLM endpoint (after normalize): ${effectiveUrl}`);
  }

  const state = loadState();
  const sourceFeed = await fetchFeed(config.sourceUrl);
  const normalizedItems = (sourceFeed.items || []).map((item) => ({
    ...item,
    sourceId: getSourceId(item)
  }));

  const unseenItems = normalizedItems
    .filter((item) => !state.seenSourceIds.includes(item.sourceId))
    .sort((a, b) => new Date(a.isoDate || a.pubDate || 0).getTime() - new Date(b.isoDate || b.pubDate || 0).getTime());

  const selectedItems = unseenItems.slice(0, Math.max(0, config.maxNewItems));
  const enrichedStoredResults = await Promise.all(
    (state.publishedItems || []).map((item) => enrichPublishedItem(item, config))
  );
  const storedPublishedItems = enrichedStoredResults.map((result) => result.item);
  const enrichedItems = await Promise.all(
    selectedItems.map(async (item) => {
      if (!config.fetchArticleContent) {
        return item;
      }

      const articleData = await fetchArticleContent(item.link, config);
      return {
        ...item,
        ...articleData
      };
    })
  );
  const generatedItems = enrichedItems.map((item) => transformItem(item, config));
  const mergedPublishedItems = sortByPubDateDesc(
    uniqueBy([...generatedItems, ...storedPublishedItems], (item) => item.guid)
  ).slice(0, Math.max(1, config.maxFeedItems));
  const generatedPostResults = await Promise.all(
    mergedPublishedItems.map((item) => generateStoredXPost(item, config))
  );
  const publishedItems = generatedPostResults.map((result) => result.item);

  const sourceXml = buildRssXml(
    {
      title: config.feedTitle,
      link: config.feedLink,
      description: config.feedDescription
    },
    publishedItems
  );
  const xFeedSourceItems = sortByPubDateDesc(
    uniqueBy(publishedItems, (item) => {
      const sourceKey = String(item.link || "").trim().toLowerCase();
      const postKey = String(item.generatedPostText || "").trim().toLowerCase();
      return `${sourceKey}::${postKey}`;
    })
  ).slice(0, Math.max(1, config.maxXFeedItems));
  const xFeedItems = xFeedSourceItems.map((item) => transformXPostItem(item, config));
  const xFeedXml = buildRssXml(
    {
      title: config.xFeedTitle,
      link: config.xFeedLink,
      description: config.xFeedDescription
    },
    xFeedItems
  );

  saveFile(SOURCE_FEED_FILE, sourceXml);
  saveFile(X_FEED_FILE, xFeedXml);
  saveState({
    version: 1,
    lastBuildAt: new Date().toISOString(),
    seenSourceIds: uniqueBy(
      [...state.seenSourceIds, ...generatedItems.map((item) => item.sourceId)].map((id) => ({ id })),
      (item) => item.id
    ).map((item) => item.id),
    publishedItems
  });

  console.log(`Source items fetched: ${normalizedItems.length}`);
  console.log(`New items published this run: ${generatedItems.length}`);
  console.log(
    `Article content extracted: ${enrichedItems.filter((item) => item.extractedFromSource).length}`
  );
  console.log(
    `Stored items backfilled: ${enrichedStoredResults.filter((result) => result.backfilled).length}`
  );
  console.log(`X posts generated or refreshed: ${generatedPostResults.filter((result) => result.generated).length}`);
  console.log(`X posts generated by LLM: ${generatedPostResults.filter((result) => result.usedLlm).length}`);
  const llmErrors = publishedItems.filter((item) => item.generatedPostError);
  if (llmErrors.length > 0) {
    console.warn(
      `LLM errors on ${llmErrors.length} item(s). Example: ${llmErrors[0].generatedPostError}`
    );
  }
  console.log(`Feed items retained: ${publishedItems.length}`);
  console.log(`X feed items retained (unique/latest): ${xFeedItems.length}`);
  console.log(`Source feed written to: ${SOURCE_FEED_FILE}`);
  console.log(`X feed written to: ${X_FEED_FILE}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
