import { normalizeUrl, getHostname } from "./searchClassifier.js";

export const MAX_QUICK_ACCESS_ITEMS = 8;
export const MAX_CUSTOM_QUICK_LINKS = 8;

export const LEGACY_DEFAULT_QUICK_LINKS = [
  {
    id: "chatgpt",
    title: "ChatGPT",
    url: "https://chatgpt.com",
    order: 0
  },
  {
    id: "github",
    title: "GitHub",
    url: "https://github.com",
    order: 1
  },
  {
    id: "app-store-connect",
    title: "App Store Connect",
    url: "https://appstoreconnect.apple.com",
    order: 2
  },
  {
    id: "apple-developer",
    title: "Apple Developer",
    url: "https://developer.apple.com",
    order: 3
  },
  {
    id: "amazon",
    title: "Amazon",
    url: "https://amazon.com",
    order: 4
  },
  {
    id: "google",
    title: "Google",
    url: "https://google.com",
    order: 5
  },
  {
    id: "gmail",
    title: "Gmail",
    url: "https://mail.google.com",
    order: 6
  }
];

const LEGACY_DEFAULT_KEYS = new Set(
  LEGACY_DEFAULT_QUICK_LINKS.map((link) => legacyLinkKey(link))
);

export function normalizeQuickLinks(quickLinks) {
  const source = Array.isArray(quickLinks) ? quickLinks : [];

  return source
    .slice()
    .filter((link) => link?.url && !isLegacyDefaultLink(link))
    .filter((link) => isWebQuickLinkUrl(link.url))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, MAX_CUSTOM_QUICK_LINKS)
    .map((link, index) => ({
      id: link.id || crypto.randomUUID(),
      title: link.title || getHostname(link.url),
      url: normalizeUrl(link.url),
      iconUrl: link.iconUrl || faviconUrl(link.url),
      order: index,
      source: "custom"
    }));
}

export function createQuickLink({ id, title, url }, existingLinks) {
  const normalizedUrl = normalizeUrl(url);
  if (!isWebQuickLinkUrl(normalizedUrl)) {
    throw new Error("Quick links must use http or https URLs.");
  }

  return {
    id: id || crypto.randomUUID(),
    title: title.trim(),
    url: normalizedUrl,
    iconUrl: faviconUrl(normalizedUrl),
    order: Math.min(existingLinks.length, MAX_CUSTOM_QUICK_LINKS - 1),
    source: "custom"
  };
}

export function promoteRecommendationToQuickLink(link, existingLinks) {
  return createQuickLink(
    {
      title: link.title,
      url: link.url
    },
    existingLinks
  );
}

export function reorderQuickLinks(quickLinks, draggedId, targetId) {
  const links = normalizeQuickLinks(quickLinks);
  const fromIndex = links.findIndex((link) => link.id === draggedId);
  const toIndex = links.findIndex((link) => link.id === targetId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return links;
  }

  const [moved] = links.splice(fromIndex, 1);
  links.splice(toIndex, 0, moved);

  return links.map((link, index) => ({
    ...link,
    order: index
  }));
}

export function createRecommendedQuickLink(historyItem, order) {
  const normalizedUrl = normalizeUrl(historyItem.url);
  return {
    id: `recommended-${historyItem.id || normalizedUrl}`,
    title: historyItem.title || getHostname(normalizedUrl),
    url: normalizedUrl,
    iconUrl: faviconUrl(normalizedUrl),
    order,
    source: "recommended"
  };
}

export function faviconUrl(url) {
  const domain = getHostname(normalizeUrl(url));
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function isWebQuickLinkUrl(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLegacyDefaultLink(link) {
  return LEGACY_DEFAULT_KEYS.has(legacyLinkKey(link));
}

function legacyLinkKey(link) {
  return `${link.id || ""}|${normalizeUrl(link.url || "")}`;
}
