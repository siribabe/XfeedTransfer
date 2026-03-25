const {
  stripHtml,
  shortenText,
  buildPostText
} = require("./transform-post");

const DEFAULT_LLM_API_URL = "https://api.openai.com/v1/chat/completions";

const POE_CHAT_COMPLETIONS_URL = "https://api.poe.com/v1/chat/completions";

function resolveLlmApiUrl(raw) {
  const trimmed = String(raw || "").trim();
  const lowered = trimmed.toLowerCase();

  if (!trimmed) {
    return DEFAULT_LLM_API_URL;
  }

  if (
    lowered === "poe" ||
    lowered === "https://poe.com" ||
    lowered === "http://poe.com" ||
    lowered === "https://www.poe.com" ||
    lowered === "http://www.poe.com"
  ) {
    return POE_CHAT_COMPLETIONS_URL;
  }

  try {
    const url = new URL(trimmed);
    const pathOnly = url.pathname.replace(/\/+$/, "") || "";

    if (!pathOnly) {
      url.pathname = "/v1/chat/completions";
      return url.toString();
    }

    if (pathOnly === "/v1") {
      url.pathname = "/v1/chat/completions";
      return url.toString();
    }

    if (pathOnly === "/v1/chat") {
      url.pathname = "/v1/chat/completions";
      return url.toString();
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

const DEFAULT_USER_PROMPT_TEMPLATE = [
  "Write one English X post in plain text based on the following article.",
  "Requirements:",
  "- Sound native to X: sharp hook, high shareability, and strong scroll-stopping phrasing.",
  "- Keep it professional, witty, and slightly playful, but still credible.",
  "- Make it read like one finished post, not a structured note or recap.",
  "- Be fact-first. Do not invent details, quotes, data, reactions, or implications that are not supported by the article.",
  "- Stay within {{x_post_max_length}} characters total (including URL + hashtags).",
  "- Length: aim to use roughly 70%–95% of that character budget—several sentences with concrete facts from the article, not a one-line headline rewrite.",
  "- Try to reach at least about {{x_post_soft_min_chars}} characters of meaningful prose in the full post (still hard-capped at {{x_post_max_length}}).",
  "- Use 1 or 2 fitting emoji naturally if they improve punch and readability.",
  "- Do not use markdown, bullets, or surrounding quotation marks.",
  "- Do not use labels or sections such as 'Title:', 'Summary:', 'Key points:', 'Takeaway:', or similar.",
  "- Include the source URL exactly once.",
  "- End the post with exactly 3 to 5 relevant hashtags that fit the topic and feel current on X.",
  "- Prefer broadly used, topic-relevant hashtags. Do not invent niche or fake trending tags.",
  "- Do not say 'according to the article' or 'the article says' unless absolutely necessary.",
  "- Output only the final post text.",
  "",
  "Article title: {{title}}",
  "Summary: {{summary}}",
  "Source URL: {{source_url}}",
  "Published at: {{pub_date}}",
  "",
  "Article body:",
  "{{article_text}}"
].join("\n");

function renderTemplate(template, variables) {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] || "") : "";
  });
}

function defaultSystemPrompt(maxLength) {
  return [
    "You are an expert English X (Twitter) editor for a tech and blockchain news automation workflow.",
    `Return exactly one post with a maximum length of ${maxLength} characters (including the source URL and trailing hashtags).`,
    "Aim to use most of that budget: about 70% to 95% of the limit, with multiple sentences and concrete detail drawn from the source. Avoid ultra-short teaser posts unless the source has almost nothing to say.",
    "The post must be plain text, directly publishable, fact-first, and faithful to the source material.",
    "Write in a style that is professional, witty, punchy, and built for engagement on X without becoming sensational fiction.",
    "It must read like one clean post, not a titled recap, summary block, or multi-section note.",
    "Use 1 or 2 suitable emoji naturally, not excessively.",
    "Use strong framing and crisp phrasing, but never fabricate facts, numbers, quotes, motives, market impact, or broader conclusions.",
    "End with exactly 3 to 5 relevant hashtags that match the topic and feel current on X.",
    "Include the source URL exactly once.",
    "Do not add labels like 'Tweet:' or 'Post:'. Do not add labels like 'Title:' or 'Summary:'."
  ].join(" ");
}

function extractMessageText(content) {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part.text === "string") {
          return part.text;
        }

        if (part && typeof part.content === "string") {
          return part.content;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function getCompletionText(payload) {
  const message = payload?.choices?.[0]?.message;
  return extractMessageText(message?.content);
}

function normalizeXPostText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^["“”'\s]+|["“”'\s]+$/g, "")
    .trim();
}

function splitTrailingHashtags(text) {
  const normalized = normalizeXPostText(text);
  const match = normalized.match(/^(.*?)(\s+(?:#[A-Za-z0-9_]+(?:\s+|$))+)\s*$/);

  if (!match) {
    return {
      body: normalized,
      trailingHashtags: ""
    };
  }

  return {
    body: match[1].trim(),
    trailingHashtags: match[2].trim()
  };
}

function ensureLengthWithLink(text, maxLength, link) {
  const cleanText = normalizeXPostText(text);
  const cleanLink = String(link || "").trim();

  if (!cleanLink) {
    return shortenText(cleanText, maxLength);
  }

  const textWithoutDuplicateLink = cleanText.replace(cleanLink, "").replace(/\s+/g, " ").trim();
  const { body, trailingHashtags } = splitTrailingHashtags(textWithoutDuplicateLink);
  const fixedSuffix = trailingHashtags ? ` ${cleanLink} ${trailingHashtags}` : ` ${cleanLink}`;
  const allowedBodyLength = Math.max(0, maxLength - fixedSuffix.length);
  const shortenedBody = shortenText(body, allowedBodyLength);

  return `${shortenedBody}${fixedSuffix}`.trim();
}

function buildFallbackPost(item, config) {
  return buildPostText({
    title: item.originalTitle || item.title || "",
    summary: item.summary || item.articleExcerpt || item.contentEncoded || "",
    link: item.link || "",
    prefix: config.xPostPrefix || config.postPrefix || "",
    suffix: config.xPostSuffix || config.postSuffix || "",
    maxLength: config.xPostMaxLength
  });
}

async function generateXPost(item, config) {
  const fallbackPost = buildFallbackPost(item, config);

  if (!config.enableLlmPostGeneration) {
    return {
      postText: fallbackPost,
      usedLlm: false,
      generationMethod: "fallback"
    };
  }

  if (!config.llmApiKey || !config.llmModel) {
    return {
      postText: fallbackPost,
      usedLlm: false,
      generationMethod: "fallback",
      error: "Missing LLM_API_KEY or LLM_MODEL."
    };
  }

  const systemPrompt = config.llmSystemPrompt || defaultSystemPrompt(config.xPostMaxLength);
  const userPrompt = renderTemplate(
    config.llmUserPromptTemplate || DEFAULT_USER_PROMPT_TEMPLATE,
    {
      title: item.originalTitle || item.title || "",
      summary: item.summary || item.articleExcerpt || "",
      article_text: shortenText(item.articleText || item.contentEncoded || "", 6000),
      source_url: item.link || "",
      pub_date: item.pubDate || "",
      x_post_max_length: config.xPostMaxLength,
      x_post_soft_min_chars: Math.max(140, Math.floor(Number(config.xPostMaxLength) * 0.55))
    }
  );

  try {
    const apiUrl = resolveLlmApiUrl(config.llmApiUrl || DEFAULT_LLM_API_URL);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: config.llmTemperature,
        max_tokens: config.llmMaxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: AbortSignal.timeout(config.llmTimeoutMs)
    });

    const responseText = await response.text();
    let payload = {};

    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      if (response.ok) {
        throw new Error(`LLM returned non-JSON response: ${responseText.slice(0, 200)}`);
      }
    }

    if (!response.ok) {
      const detail = payload?.error?.message || responseText.slice(0, 400).trim();
      throw new Error(
        `LLM API HTTP ${response.status} on ${apiUrl}: ${detail || "no body"}`
      );
    }

    const generatedText = normalizeXPostText(stripHtml(getCompletionText(payload)));

    if (!generatedText) {
      throw new Error("LLM returned empty content.");
    }

    return {
      postText: ensureLengthWithLink(generatedText, config.xPostMaxLength, item.link),
      usedLlm: true,
      generationMethod: "llm",
      model: config.llmModel
    };
  } catch (error) {
    return {
      postText: fallbackPost,
      usedLlm: false,
      generationMethod: "fallback",
      error: error.message || String(error)
    };
  }
}

module.exports = {
  DEFAULT_LLM_API_URL,
  DEFAULT_USER_PROMPT_TEMPLATE,
  resolveLlmApiUrl,
  generateXPost
};
