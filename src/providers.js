export const BUILT_IN_PROVIDERS = {
  search: [
    {
      id: "google",
      label: "Google",
      type: "search",
      urlTemplate: "https://www.google.com/search?q={query}",
      enabled: true,
      builtIn: true
    }
  ],
  ai: [
    {
      id: "chatgpt",
      label: "ChatGPT",
      type: "ai",
      urlTemplate: "https://chatgpt.com/?q={query}",
      enabled: true,
      builtIn: true
    }
  ]
};

export function getProvider(providers, type, providerId) {
  const group = providers?.[type] || BUILT_IN_PROVIDERS[type] || [];
  return group.find((provider) => provider.id === providerId && provider.enabled) || group.find((provider) => provider.enabled);
}

export function buildProviderUrl(provider, query) {
  if (!provider?.urlTemplate) {
    return "";
  }

  return provider.urlTemplate.replace("{query}", encodeURIComponent(query.trim()));
}

export function buildProviderHomeUrl(provider) {
  if (!provider?.urlTemplate) {
    return "";
  }

  try {
    const url = new URL(provider.urlTemplate);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return provider.urlTemplate.replace(/[?&][^{}]*\{query\}[^{}]*/, "").replace("{query}", "");
  }
}
