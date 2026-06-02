import { getHostname, normalizeInput } from "./searchClassifier.js";

const MAX_HISTORY_RESULTS = 8;
const MAX_RECOMMENDATION_RESULTS = 20;

export async function searchHistory(query, enabled) {
  const text = normalizeInput(query);

  if (!enabled || text.length < 2 || !globalThis.chrome?.history?.search) {
    return [];
  }

  return new Promise((resolve) => {
    try {
      globalThis.chrome.history.search(
        {
          text,
          maxResults: 40,
          startTime: 0
        },
        (results) => {
          resolve(rankHistoryResults(text, results || []).slice(0, MAX_HISTORY_RESULTS));
        }
      );
    } catch {
      resolve([]);
    }
  });
}

export function rankHistoryResults(query, results) {
  const normalizedQuery = normalizeToken(query);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  return results
    .filter((item) => item?.url && !item.url.startsWith("chrome://") && !item.url.startsWith("edge://"))
    .map((item) => {
      const title = item.title || getHostname(item.url);
      const normalizedTitle = normalizeToken(title);
      const normalizedUrl = normalizeToken(item.url);
      const domain = normalizeToken(getHostname(item.url));

      let score = 0;

      if (domain === normalizedQuery) score += 120;
      if (domain.startsWith(normalizedQuery)) score += 90;
      if (normalizedUrl.includes(normalizedQuery)) score += 70;
      if (normalizedTitle.startsWith(normalizedQuery)) score += 65;
      if (normalizedTitle.includes(normalizedQuery)) score += 45;

      const tokenMatches = queryTokens.filter((token) => normalizedTitle.includes(token) || normalizedUrl.includes(token));
      score += tokenMatches.length * 16;
      score += Math.min(item.visitCount || 0, 20);
      score += recencyScore(item.lastVisitTime);

      return {
        id: item.id || item.url,
        title,
        url: item.url,
        domain: getHostname(item.url),
        score,
        lastVisitTime: item.lastVisitTime || 0
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.lastVisitTime - a.lastVisitTime);
}

export async function getHistoryRecommendations(count, excludedUrls = [], enabled = true) {
  if (!enabled || count <= 0 || !globalThis.chrome?.history?.search) {
    return [];
  }

  return new Promise((resolve) => {
    try {
      globalThis.chrome.history.search(
        {
          text: "",
          maxResults: 240,
          startTime: 0
        },
        (results) => {
          resolve(rankRecommendedHistory(results || [], excludedUrls).slice(0, count));
        }
      );
    } catch {
      resolve([]);
    }
  });
}

export function rankRecommendedHistory(results, excludedUrls = []) {
  const excluded = new Set(excludedUrls.map((url) => normalizeUrlForCompare(url)).filter(Boolean));
  const seenDomains = new Set();

  return results
    .filter((item) => item?.url && !item.url.startsWith("chrome://") && !item.url.startsWith("edge://"))
    .filter((item) => isWebHistoryUrl(item.url))
    .filter((item) => !isSelfNewTabHistoryItem(item))
    .filter((item) => !excluded.has(normalizeUrlForCompare(item.url)))
    .map((item) => {
      const originUrl = originFromUrl(item.url);
      const domain = getHostname(originUrl);
      const domainKey = originUrl.toLowerCase();
      const title = item.title || domain;
      const score = Math.min(item.visitCount || 0, 40) + recencyScore(item.lastVisitTime);

      return {
        id: domainKey,
        title: titleForRecommendation(title, domain),
        url: originUrl,
        domain,
        domainKey,
        score,
        lastVisitTime: item.lastVisitTime || 0
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.lastVisitTime - a.lastVisitTime)
    .filter((item) => {
      if (seenDomains.has(item.domainKey)) {
        return false;
      }

      seenDomains.add(item.domainKey);
      return true;
    })
    .slice(0, MAX_RECOMMENDATION_RESULTS);
}

function recencyScore(lastVisitTime) {
  if (!lastVisitTime) {
    return 0;
  }

  const ageMs = Date.now() - lastVisitTime;
  const dayMs = 24 * 60 * 60 * 1000;

  if (ageMs < dayMs) return 20;
  if (ageMs < 7 * dayMs) return 14;
  if (ageMs < 30 * dayMs) return 8;
  return 2;
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^\p{L}\p{N}.:/-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUrlForCompare(url) {
  try {
    const parsed = new URL(url);
    if (!isWebProtocol(parsed.protocol)) {
      return "";
    }

    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = "";
    return parsed.origin.toLowerCase();
  } catch {
    return String(url || "").split("?")[0].replace(/\/$/, "");
  }
}

function isSelfNewTabHistoryItem(item) {
  if (String(item.title || "").trim().toLowerCase() === "ai new tab") {
    return true;
  }

  try {
    const parsed = new URL(item.url);
    return parsed.pathname.toLowerCase().endsWith("/newtab.html");
  } catch {
    return String(item.url || "").toLowerCase().includes("newtab.html");
  }
}

function originFromUrl(url) {
  try {
    const parsed = new URL(url);
    return isWebProtocol(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

function isWebHistoryUrl(url) {
  try {
    return isWebProtocol(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isWebProtocol(protocol) {
  return protocol === "http:" || protocol === "https:";
}

function titleForRecommendation(title, domain) {
  const trimmed = String(title || "").trim();
  if (!trimmed) {
    return domain;
  }

  return trimmed.length > 40 ? domain : trimmed;
}
