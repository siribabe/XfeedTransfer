const cheerio = require("cheerio");

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenText(value, maxLength) {
  if (!value) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizeArticleText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function pickMetaContent(document, selector) {
  const element = document(selector).first();
  return element.length ? String(element.attr("content") || "").trim() : "";
}

function collectCandidateParagraphs($, selectors) {
  return selectors.flatMap((selector) =>
    $(selector)
      .toArray()
      .map((node) => stripHtml($(node).text()))
      .filter((text) => text.length >= 50)
  );
}

function fallbackParagraphText($) {
  const paragraphs = collectCandidateParagraphs($, [
    "article p",
    "main p",
    "[itemprop='articleBody'] p",
    ".article p",
    ".article-body p",
    ".post-content p",
    ".entry-content p",
    ".content p",
    "p"
  ])
    .filter((text) => text.length >= 50);

  return normalizeArticleText(paragraphs.slice(0, 20).join("\n\n"));
}

async function fetchArticleContent(url, options = {}) {
  if (!url) {
    return {
      articleTitle: "",
      articleExcerpt: "",
      articleText: "",
      extractedFromSource: false
    };
  }

  const timeoutMs = options.fetchTimeoutMs || 15000;
  const maxChars = options.articleMaxChars || 12000;
  const userAgent = options.userAgent || "rss-to-x-bot/1.0";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const articleTitle = stripHtml(
      $("meta[property='og:title']").attr("content") ||
        $("meta[name='twitter:title']").attr("content") ||
        $("title").text() ||
        $("h1").first().text()
    );
    const articleExcerpt = stripHtml(
      $("meta[property='og:description']").attr("content") ||
        $("meta[name='twitter:description']").attr("content") ||
        $("meta[name='description']").attr("content")
    );
    const articleText = shortenText(fallbackParagraphText($), maxChars);

    return {
      articleTitle,
      articleExcerpt: shortenText(articleExcerpt, 400),
      articleText,
      extractedFromSource: Boolean(articleText)
    };
  } catch (error) {
    return {
      articleTitle: "",
      articleExcerpt: "",
      articleText: "",
      extractedFromSource: false,
      extractionError: error.message || String(error)
    };
  }
}

module.exports = {
  fetchArticleContent
};
