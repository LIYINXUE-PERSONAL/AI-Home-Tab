import { BUILT_IN_PROVIDERS } from "./providers.js";
import { MAX_CUSTOM_QUICK_LINKS, normalizeQuickLinks } from "./quickLinks.js";

const STORAGE_KEY = "aiNewTabState";

const DEFAULT_STATE = {
  meta: {
    quickLinksInitialized: false
  },
  settings: {
    customGreetingName: "",
    searchProviderId: "google",
    aiProviderId: "chatgpt",
    searchMode: "smart",
    historyAutocomplete: true
  },
  providers: BUILT_IN_PROVIDERS,
  quickLinks: [],
  dismissedRecommendationUrls: []
};

export async function loadState() {
  const stored = await storageGet(STORAGE_KEY);
  return mergeState(stored?.[STORAGE_KEY]);
}

export async function saveState(state) {
  const normalized = mergeState(state);
  await storageSet({ [STORAGE_KEY]: normalized });
  return normalized;
}

export async function updateState(updater) {
  const state = await loadState();
  const nextState = updater(structuredCloneSafe(state));
  return saveState(nextState);
}

export function mergeState(state = {}) {
  if (!state || typeof state !== "object") {
    state = {};
  }

  const quickLinks = normalizeQuickLinks(
    Array.isArray(state.quickLinks)
      ? state.quickLinks.slice(0, MAX_CUSTOM_QUICK_LINKS)
      : DEFAULT_STATE.quickLinks
  );

  return {
    meta: {
      quickLinksInitialized: true
    },
    settings: {
      ...DEFAULT_STATE.settings,
      ...(state.settings || {})
    },
    providers: {
      search: mergeProviders(DEFAULT_STATE.providers.search, state.providers?.search),
      ai: mergeProviders(DEFAULT_STATE.providers.ai, state.providers?.ai)
    },
    quickLinks,
    dismissedRecommendationUrls: Array.isArray(state.dismissedRecommendationUrls)
      ? state.dismissedRecommendationUrls.filter(Boolean)
      : DEFAULT_STATE.dismissedRecommendationUrls
  };
}

function mergeProviders(defaultProviders, storedProviders = []) {
  const providers = new Map(defaultProviders.map((provider) => [provider.id, { ...provider }]));

  for (const provider of storedProviders || []) {
    if (provider?.id) {
      providers.set(provider.id, { ...providers.get(provider.id), ...provider });
    }
  }

  return Array.from(providers.values());
}

function storageGet(key) {
  if (!globalThis.chrome?.storage?.local) {
    return Promise.resolve(readLocalFallback(key));
  }

  return globalThis.chrome.storage.local.get(key);
}

function storageSet(value) {
  if (!globalThis.chrome?.storage?.local) {
    writeLocalFallback(value);
    return Promise.resolve();
  }

  return globalThis.chrome.storage.local.set(value);
}

function readLocalFallback(key) {
  try {
    return {
      [key]: JSON.parse(globalThis.localStorage.getItem(key) || "null")
    };
  } catch {
    return { [key]: null };
  }
}

function writeLocalFallback(value) {
  for (const [key, item] of Object.entries(value)) {
    globalThis.localStorage.setItem(key, JSON.stringify(item));
  }
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}
