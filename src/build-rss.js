function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildItemXml(item) {
  return [
    "    <item>",
    `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <pubDate>${escapeXml(item.pubDate)}</pubDate>`,
    `      <description><![CDATA[${item.description || ""}]]></description>`,
    item.contentEncoded
      ? `      <content:encoded><![CDATA[${item.contentEncoded}]]></content:encoded>`
      : "",
    "    </item>"
  ].filter(Boolean).join("\n");
}

function buildRssXml(meta, items) {
  const itemXml = items.map(buildItemXml).join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<rss version=\"2.0\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\">",
    "  <channel>",
    `    <title>${escapeXml(meta.title)}</title>`,
    `    <link>${escapeXml(meta.link)}</link>`,
    `    <description>${escapeXml(meta.description)}</description>`,
    `    <lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>`,
    itemXml,
    "  </channel>",
    "</rss>",
    ""
  ].join("\n");
}

module.exports = {
  buildRssXml
};
