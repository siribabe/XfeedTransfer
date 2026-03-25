const crypto = require("node:crypto");

function stripHtml(value) {
  return String(value || "")
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

  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function getSourceId(item) {
  const raw = item.guid || item.id || item.link || item.title || JSON.stringify(item);
  return crypto.createHash("sha1").update(String(raw)).digest("hex");
}

function toDateString(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

function isUsefulSummary(summary) {
  if (!summary) {
    return false;
  }

  const lower = summary.toLowerCase();
  const urlCount = (summary.match(/https?:\/\//g) || []).length;
  const metadataHits = [
    "article url:",
    "comments url:",
    "points:",
    "# comments:"
  ].filter((token) => lower.includes(token)).length;

  if (urlCount >= 2 || metadataHits >= 2) {
    return false;
  }

  return summary.length >= 24;
}

function toPlainParagraphs(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((part) => stripHtml(part))
    .filter(Boolean)
    .join("\n\n");
}

function buildPostText({ title, summary, link, prefix, suffix, maxLength }) {
  const cleanTitle = shortenText(stripHtml(title), 110);
  const normalizedSummary = stripHtml(summary);
  const cleanSummary = isUsefulSummary(normalizedSummary)
    ? shortenText(normalizedSummary, 90)
    : "";

  let text = cleanTitle;

  if (cleanSummary) {
    text += ` | ${cleanSummary}`;
  }

  if (prefix) {
    text = `${prefix} ${text}`.trim();
  }

  if (suffix) {
    text = `${text} ${suffix}`.trim();
  }

  if (link) {
    text = `${text} ${link}`.trim();
  }

  return shortenText(text, maxLength);
}

function transformItem(item, options = {}) {
  const sourceId = getSourceId(item);
  const originalTitle = stripHtml(item.articleTitle || item.title || "");
  const originalSummary = stripHtml(
    item.contentSnippet || item.summary || item.content || item.contentEncoded || ""
  );
  const articleExcerpt = stripHtml(item.articleExcerpt || "");
  const articleText = toPlainParagraphs(item.articleText || "");
  const usefulSummary = isUsefulSummary(articleExcerpt)
    ? articleExcerpt
    : isUsefulSummary(originalSummary)
      ? originalSummary
      : "";
  const link = String(item.link || "").trim();
  const pubDate = toDateString(item.isoDate || item.pubDate);
  const title = buildPostText({
    title: originalTitle,
    summary: usefulSummary,
    link,
    prefix: options.postPrefix || "",
    suffix: options.postSuffix || "",
    maxLength: options.postMaxLength || 260
  });

  const descriptionParts = [
    originalTitle ? `Original title: ${originalTitle}` : "",
    usefulSummary ? `Summary: ${shortenText(usefulSummary, 300)}` : "",
    articleText ? `Article text: ${articleText}` : "",
    link ? `Source: ${link}` : ""
  ].filter(Boolean);

  return {
    sourceId,
    guid: `xfeed-${sourceId}`,
    title,
    link,
    pubDate,
    description: descriptionParts.join("\n"),
    contentEncoded: articleText || usefulSummary || originalSummary || originalTitle,
    originalTitle,
    summary: usefulSummary,
    articleExcerpt,
    articleText
  };
}

function transformXPostItem(item) {
  const sourceId = item.sourceId || getSourceId(item);
  const generatedPostText = stripHtml(item.generatedPostText || item.title || "");

  return {
    guid: `xpost-${sourceId}`,
    title: generatedPostText,
    link: String(item.link || "").trim(),
    pubDate: toDateString(item.pubDate),
    description: generatedPostText,
    contentEncoded: generatedPostText
  };
}

module.exports = {
  buildPostText,
  getSourceId,
  isUsefulSummary,
  shortenText,
  stripHtml,
  transformItem,
  transformXPostItem
};
