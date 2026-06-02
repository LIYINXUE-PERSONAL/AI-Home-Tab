import { buildProviderHomeUrl, buildProviderUrl, getProvider } from "./providers.js";
import { classifyInput, getHostname, normalizeInput, normalizeUrl } from "./searchClassifier.js";
import { getHistoryRecommendations, searchHistory } from "./historySearch.js";
import { getGreetingName, getProfileEmail } from "./profile.js";
import {
  createQuickLink,
  createRecommendedQuickLink,
  isWebQuickLinkUrl,
  MAX_CUSTOM_QUICK_LINKS,
  MAX_QUICK_ACCESS_ITEMS,
  normalizeQuickLinks,
  promoteRecommendationToQuickLink,
  reorderQuickLinks
} from "./quickLinks.js";
import { loadState, saveState } from "./storage.js";

const state = {
  app: null,
  profileEmail: "",
  suggestions: [],
  selectedSuggestionIndex: 0,
  editingShortcutId: "",
  draggedQuickLinkId: "",
  openQuickLinkMenuId: "",
  skippedRecommendationUrls: []
};

const elements = {
  greeting: document.querySelector("#greeting"),
  settingsButton: document.querySelector("#settingsButton"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  suggestions: document.querySelector("#suggestions"),
  modeButton: document.querySelector("#modeButton"),
  modeMenu: document.querySelector("#modeMenu"),
  modeLabel: document.querySelector("#modeLabel"),
  quickLinksRow: document.querySelector("#quickLinksRow"),
  shortcutModal: document.querySelector("#shortcutModal"),
  shortcutForm: document.querySelector("#shortcutForm"),
  shortcutDialogTitle: document.querySelector("#shortcutDialogTitle"),
  shortcutId: document.querySelector("#shortcutId"),
  shortcutTitle: document.querySelector("#shortcutTitle"),
  shortcutUrl: document.querySelector("#shortcutUrl"),
  deleteShortcutButton: document.querySelector("#deleteShortcutButton"),
  aiShortcutButton: document.querySelector("#aiShortcutButton"),
  cancelShortcutButton: document.querySelector("#cancelShortcutButton"),
  closeShortcutModalButton: document.querySelector("#closeShortcutModalButton"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsForm: document.querySelector("#settingsForm"),
  customGreetingName: document.querySelector("#customGreetingName"),
  historyAutocomplete: document.querySelector("#historyAutocomplete"),
  resetDismissedRecommendationsButton: document.querySelector("#resetDismissedRecommendationsButton"),
  cancelSettingsButton: document.querySelector("#cancelSettingsButton"),
  closeSettingsButton: document.querySelector("#closeSettingsButton")
};

const suggestionDebouncer = debounce(refreshSuggestions, 120);

boot().catch((error) => {
  document.documentElement.dataset.aiNewTabBootError = error?.message || String(error);
  console.error(error);
});

async function boot() {
  state.app = await loadState();
  state.app.quickLinks = normalizeQuickLinks(state.app.quickLinks);
  await saveState(state.app);

  state.profileEmail = await getProfileEmail();

  renderGreeting();
  renderSearchMode();
  await renderQuickLinks();
  bindEvents();

  elements.searchInput.focus();
  resizeSearchInput();
}

function bindEvents() {
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    executeSelectedOrDefault();
  });

  elements.searchInput.addEventListener("input", () => {
    resizeSearchInput();
    suggestionDebouncer();
  });

  elements.searchInput.addEventListener("keydown", handleSearchKeydown);
  elements.searchInput.addEventListener("focus", suggestionDebouncer);
  elements.modeButton.addEventListener("click", toggleModeMenu);
  elements.modeMenu.addEventListener("click", selectSearchMode);

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-area")) {
      hideSuggestions();
    }

    if (!event.target.closest(".quick-link-menu")) {
      state.openQuickLinkMenuId = "";
      elements.quickLinksRow.querySelectorAll(".quick-link-menu-list").forEach((menu) => {
        menu.hidden = true;
      });
    }

    if (!event.target.closest(".mode-button") && !event.target.closest(".mode-menu")) {
      elements.modeMenu.hidden = true;
    }
  });

  elements.aiShortcutButton.addEventListener("click", executeAiShortcut);
  elements.cancelShortcutButton.addEventListener("click", closeShortcutModal);
  elements.closeShortcutModalButton.addEventListener("click", closeShortcutModal);
  elements.shortcutModal.addEventListener("click", closeModalOnBackdrop);
  elements.shortcutForm.addEventListener("submit", saveShortcutFromForm);
  elements.deleteShortcutButton.addEventListener("click", deleteEditingShortcut);

  elements.settingsButton.addEventListener("click", openSettingsModal);
  elements.cancelSettingsButton.addEventListener("click", closeSettingsModal);
  elements.closeSettingsButton.addEventListener("click", closeSettingsModal);
  elements.resetDismissedRecommendationsButton.addEventListener("click", resetDismissedRecommendations);
  elements.settingsModal.addEventListener("click", closeModalOnBackdrop);
  elements.settingsForm.addEventListener("submit", saveSettingsFromForm);
}

function renderGreeting() {
  const name = getGreetingName(state.app.settings, state.profileEmail);
  elements.greeting.textContent = `Hey ${name}, what's on your mind today?`;
}

function renderSearchMode() {
  const labels = {
    smart: "Smart",
    search: "Search",
    ai: "Ask AI"
  };
  const mode = state.app.settings.searchMode || "smart";
  elements.modeLabel.textContent = labels[mode] || labels.smart;
  elements.modeMenu.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.mode === mode));
  });
}

function toggleModeMenu(event) {
  event.preventDefault();
  elements.modeMenu.hidden = !elements.modeMenu.hidden;
}

async function selectSearchMode(event) {
  const button = event.target.closest("[data-mode]");
  if (!button) {
    return;
  }

  state.app.settings.searchMode = button.dataset.mode;
  elements.modeMenu.hidden = true;
  await saveState(state.app);
  renderSearchMode();
  suggestionDebouncer();
}

function resizeSearchInput() {
  elements.searchInput.style.height = "auto";
  elements.searchInput.style.height = `${Math.min(elements.searchInput.scrollHeight, 128)}px`;
}

function executeAiShortcut() {
  const query = normalizeInput(elements.searchInput.value);
  const aiProvider = getProvider(state.app.providers, "ai", state.app.settings.aiProviderId);

  if (!query) {
    globalThis.location.assign(buildProviderHomeUrl(aiProvider));
    return;
  }

  executeSuggestion(aiSuggestion(query, aiProvider));
}

async function refreshSuggestions() {
  const query = normalizeInput(elements.searchInput.value);

  if (!query) {
    state.suggestions = [];
    state.selectedSuggestionIndex = 0;
    renderSuggestions();
    return;
  }

  const requestQuery = query;
  const classification = classifyInput(query);
  const historyResults = await searchHistory(query, state.app.settings.historyAutocomplete);

  if (normalizeInput(elements.searchInput.value) !== requestQuery) {
    return;
  }

  state.suggestions = buildSuggestions(query, classification, historyResults);
  state.selectedSuggestionIndex = 0;
  renderSuggestions();
}

function buildSuggestions(query, classification, historyResults) {
  const searchProvider = getProvider(state.app.providers, "search", state.app.settings.searchProviderId);
  const aiProvider = getProvider(state.app.providers, "ai", state.app.settings.aiProviderId);
  const suggestions = [];
  const actionMode = state.app.settings.searchMode || "smart";

  if (actionMode === "ai" || (actionMode === "smart" && classification.type === "ai")) {
    suggestions.push(aiSuggestion(query, aiProvider));
    suggestions.push(searchSuggestion(query, searchProvider));
  } else {
    suggestions.push(searchSuggestion(query, searchProvider));
    suggestions.push(aiSuggestion(query, aiProvider));
  }

  if (classification.type === "navigate") {
    suggestions.push({
      id: "open-url",
      kind: "navigate",
      icon: "↗",
      title: `Open ${getHostname(classification.url)}`,
      detail: classification.url,
      url: classification.url
    });
  }

  appendUniqueHistory(suggestions, historyResults, 8);

  return suggestions.slice(0, 8);
}

function appendUniqueHistory(suggestions, historyResults, limit) {
  const existingUrls = new Set(suggestions.filter((item) => item.url).map((item) => item.url));

  for (const item of historyResults) {
    if (suggestions.length >= limit) {
      break;
    }

    if (!existingUrls.has(item.url)) {
      suggestions.push(historySuggestion(item, "Open"));
      existingUrls.add(item.url);
    }

    if (suggestions.length >= 8) {
      break;
    }
  }
}

function searchSuggestion(query, provider) {
  return {
    id: "search",
    kind: "search",
    icon: "⌕",
    title: `Search ${provider.label}`,
    detail: query,
    provider,
    url: buildProviderUrl(provider, query)
  };
}

function aiSuggestion(query, provider) {
  return {
    id: "ai",
    kind: "ai",
    icon: "✦",
    title: `Ask ${provider.label}`,
    detail: query,
    provider,
    url: buildProviderUrl(provider, query)
  };
}

function historySuggestion(item, titlePrefix) {
  return {
    id: `history-${item.id}`,
    kind: "history",
    icon: faviconFor(item.url),
    title: `${titlePrefix} ${item.title}`,
    detail: item.domain,
    url: item.url
  };
}

function renderSuggestions() {
  if (!state.suggestions.length) {
    elements.suggestions.hidden = true;
    elements.suggestions.innerHTML = "";
    return;
  }

  elements.suggestions.hidden = false;
  elements.suggestions.innerHTML = "";

  state.suggestions.forEach((suggestion, index) => {
    const row = document.createElement("button");
    row.className = "suggestion-row";
    row.type = "button";
    row.role = "option";
    row.dataset.index = String(index);
    row.setAttribute("aria-selected", String(index === state.selectedSuggestionIndex));

    const icon = document.createElement("span");
    icon.className = "suggestion-icon";
    renderIcon(icon, suggestion.icon);

    const text = document.createElement("span");
    text.className = "suggestion-text";

    const title = document.createElement("span");
    title.className = "suggestion-title";
    title.textContent = suggestion.title;

    const detail = document.createElement("span");
    detail.className = "suggestion-detail";
    detail.textContent = suggestion.detail;

    text.append(title, detail);
    row.append(icon, text);
    row.addEventListener("click", () => executeSuggestion(suggestion));
    row.addEventListener("mouseenter", () => {
      state.selectedSuggestionIndex = index;
      renderSuggestionSelection();
    });

    elements.suggestions.append(row);
  });
}

function renderSuggestionSelection() {
  [...elements.suggestions.querySelectorAll(".suggestion-row")].forEach((row, index) => {
    row.setAttribute("aria-selected", String(index === state.selectedSuggestionIndex));
  });
}

function executeSelectedOrDefault() {
  const query = normalizeInput(elements.searchInput.value);
  if (!query) {
    return;
  }

  const selected = state.suggestions[state.selectedSuggestionIndex];
  executeSuggestion(selected || defaultSuggestion(query));
}

function defaultSuggestion(query) {
  const classification = classifyInput(query);
  const searchProvider = getProvider(state.app.providers, "search", state.app.settings.searchProviderId);
  const aiProvider = getProvider(state.app.providers, "ai", state.app.settings.aiProviderId);

  if (classification.type === "navigate") {
    return {
      kind: "navigate",
      url: classification.url
    };
  }

  if (classification.type === "ai") {
    return aiSuggestion(query, aiProvider);
  }

  return searchSuggestion(query, searchProvider);
}

function executeSuggestion(suggestion) {
  if (!suggestion?.url) {
    return;
  }

  globalThis.location.assign(suggestion.url);
}

function handleSearchKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    executeSelectedOrDefault();
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
    return;
  }

  if (event.key === "Escape") {
    hideSuggestions();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    const aiProvider = getProvider(state.app.providers, "ai", state.app.settings.aiProviderId);
    executeSuggestion(aiSuggestion(normalizeInput(elements.searchInput.value), aiProvider));
  }
}

function moveSelection(direction) {
  if (!state.suggestions.length) {
    return;
  }

  const count = state.suggestions.length;
  state.selectedSuggestionIndex = (state.selectedSuggestionIndex + direction + count) % count;
  renderSuggestionSelection();
}

function hideSuggestions() {
  elements.suggestions.hidden = true;
}

async function renderQuickLinks() {
  elements.quickLinksRow.innerHTML = "";
  const customLinks = normalizeQuickLinks(state.app.quickLinks);
  const addTileCount = customLinks.length < MAX_CUSTOM_QUICK_LINKS ? 1 : 0;
  const recommendationCount = Math.max(0, MAX_QUICK_ACCESS_ITEMS - customLinks.length - addTileCount);
  const excludedRecommendationUrls = [
    ...customLinks.map((link) => link.url),
    ...(state.app.dismissedRecommendationUrls || []),
    ...state.skippedRecommendationUrls,
    globalThis.location.href,
    globalThis.location.origin,
    globalThis.location.pathname
  ];
  const recommendations = await getHistoryRecommendations(
    recommendationCount,
    excludedRecommendationUrls,
    state.app.settings.historyAutocomplete
  );
  const recommendedLinks = recommendations.map((item, index) => createRecommendedQuickLink(item, customLinks.length + index));
  const links = [...customLinks, ...recommendedLinks].slice(0, MAX_QUICK_ACCESS_ITEMS - addTileCount);

  links.forEach((link) => {
    elements.quickLinksRow.append(createQuickLinkElement(link));
  });

  if (customLinks.length >= MAX_CUSTOM_QUICK_LINKS) {
    return;
  }

  elements.quickLinksRow.append(createAddQuickLinkElement());
}

function createAddQuickLinkElement() {
  const addItem = document.createElement("button");
  addItem.className = "quick-link";
  addItem.type = "button";
  addItem.title = "Add shortcut";
  addItem.innerHTML = `
    <span class="quick-link-icon add-icon" aria-hidden="true">+</span>
    <span class="quick-link-label">Add</span>
  `;
  addItem.addEventListener("click", () => openShortcutModal());
  return addItem;
}

function createQuickLinkElement(link) {
  const item = document.createElement("div");
  item.className = `quick-link ${link.source === "recommended" ? "recommended-quick-link" : ""}`;
  item.role = "button";
  item.tabIndex = 0;
  item.title = `${link.title} - ${link.url}`;
  item.draggable = true;
  item.dataset.linkId = link.id;
  item.dataset.linkSource = link.source;
  item.dataset.linkTitle = link.title;
  item.dataset.linkUrl = link.url;

  const icon = document.createElement("span");
  icon.className = "quick-link-icon";

  if (link.source === "recommended") {
    const marker = document.createElement("span");
    marker.className = "recommendation-marker";
    marker.textContent = "★";
    marker.title = "Recommended from history";
    icon.append(marker);
  }

  const image = document.createElement("img");
  image.src = link.iconUrl || faviconFor(link.url);
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("error", () => {
    image.remove();
    icon.append(link.title.slice(0, 1).toUpperCase());
  });
  icon.append(image);

  const menu = createQuickLinkMenu(link);
  icon.append(menu);

  const label = document.createElement("span");
  label.className = "quick-link-label";
  label.textContent = link.title;

  item.append(icon, label);
  item.addEventListener("click", () => {
    if (!state.openQuickLinkMenuId) {
      globalThis.location.assign(link.url);
    }
  });
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      globalThis.location.assign(link.url);
    }
  });
  item.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    toggleQuickLinkMenu(link.id);
  });
  item.addEventListener("dragstart", (event) => handleQuickLinkDragStart(event, link));
  item.addEventListener("dragover", handleQuickLinkDragOver);
  item.addEventListener("dragleave", handleQuickLinkDragLeave);
  item.addEventListener("drop", (event) => handleQuickLinkDrop(event, link));
  item.addEventListener("dragend", handleQuickLinkDragEnd);

  return item;
}

function createQuickLinkMenu(link) {
  const wrapper = document.createElement("span");
  wrapper.className = "quick-link-menu";

  const button = document.createElement("button");
  button.className = "quick-link-menu-button";
  button.type = "button";
  button.title = "Shortcut actions";
  button.setAttribute("aria-label", "Shortcut actions");
  button.textContent = "...";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleQuickLinkMenu(link.id);
  });

  const menu = document.createElement("span");
  menu.className = "quick-link-menu-list";
  menu.hidden = state.openQuickLinkMenuId !== link.id;

  const primaryButton = document.createElement("button");
  primaryButton.type = "button";
  primaryButton.textContent = link.source === "recommended" ? "Pin" : "Edit";
  primaryButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (link.source === "recommended") {
      await pinQuickLink(link);
    } else {
      await editQuickLink(link);
    }
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await removeQuickLink(link);
  });

  menu.append(primaryButton, removeButton);
  wrapper.append(button, menu);
  return wrapper;
}

function openShortcutModal(link = null) {
  state.editingShortcutId = link?.id || "";
  elements.shortcutDialogTitle.textContent = link ? "Edit Shortcut" : "Add Shortcut";
  elements.shortcutId.value = link?.id || "";
  elements.shortcutTitle.value = link?.title || "";
  elements.shortcutUrl.value = link?.url || "";
  elements.deleteShortcutButton.hidden = !link;
  elements.shortcutModal.hidden = false;
  elements.shortcutTitle.focus();
}

async function toggleQuickLinkMenu(linkId) {
  state.openQuickLinkMenuId = state.openQuickLinkMenuId === linkId ? "" : linkId;
  await renderQuickLinks();
}

async function editQuickLink(link) {
  state.openQuickLinkMenuId = "";
  openShortcutModal(link);
}

async function pinQuickLink(link) {
  state.openQuickLinkMenuId = "";
  await promoteRecommendedLink(link);
}

async function removeQuickLink(link) {
  state.openQuickLinkMenuId = "";

  if (link.source === "recommended") {
    state.app.dismissedRecommendationUrls = uniqueUrls([
      ...(state.app.dismissedRecommendationUrls || []),
      link.url
    ]);
  } else {
    state.app.quickLinks = normalizeQuickLinks(state.app.quickLinks).filter((item) => item.id !== link.id);
  }

  await saveState(state.app);
  await renderQuickLinks();
}

async function promoteRecommendedLink(link) {
  const existing = normalizeQuickLinks(state.app.quickLinks);
  const existingMatch = existing.find((item) => item.url === link.url);

  if (existingMatch) {
    return existingMatch;
  }

  const promoted = promoteRecommendationToQuickLink(link, existing);
  state.app.quickLinks = normalizeQuickLinks([...existing, promoted]);
  state.app.dismissedRecommendationUrls = uniqueUrls([
    ...(state.app.dismissedRecommendationUrls || []),
    link.url
  ]);
  await saveState(state.app);
  await renderQuickLinks();
  return normalizeQuickLinks(state.app.quickLinks).find((item) => item.url === link.url) || promoted;
}

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

function handleQuickLinkDragStart(event, link) {
  state.draggedQuickLinkId = link.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", link.id);
  event.currentTarget.classList.add("is-dragging");
}

function handleQuickLinkDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("is-drop-target");
}

function handleQuickLinkDragLeave(event) {
  event.currentTarget.classList.remove("is-drop-target");
}

async function handleQuickLinkDrop(event, targetLink) {
  event.preventDefault();
  event.currentTarget.classList.remove("is-drop-target");

  const draggedId = event.dataTransfer.getData("text/plain") || state.draggedQuickLinkId;
  if (!draggedId || draggedId === targetLink.id) {
    return;
  }

  const visibleLinks = [...elements.quickLinksRow.querySelectorAll(".quick-link[data-link-id]")].map((item) => ({
    id: item.dataset.linkId,
    source: item.dataset.linkSource
  }));
  const draggedVisible = visibleLinks.find((item) => item.id === draggedId);

  if (!draggedVisible) {
    return;
  }

  if (draggedVisible.source === "custom" && targetLink.source === "custom") {
    state.app.quickLinks = reorderQuickLinks(state.app.quickLinks, draggedId, targetLink.id);
    await saveState(state.app);
    await renderQuickLinks();
    return;
  }

  await persistVisibleQuickLinkOrder(draggedId, targetLink.id);
}

function handleQuickLinkDragEnd(event) {
  event.currentTarget.classList.remove("is-dragging");
  elements.quickLinksRow.querySelectorAll(".is-drop-target").forEach((item) => {
    item.classList.remove("is-drop-target");
  });
  state.draggedQuickLinkId = "";
}

async function persistVisibleQuickLinkOrder(draggedId, targetId) {
  const visibleTiles = [...elements.quickLinksRow.querySelectorAll(".quick-link[data-link-id]")];
  const visibleLinks = visibleTiles.map((item) => ({
    id: item.dataset.linkId,
    source: item.dataset.linkSource,
    title: item.dataset.linkTitle || "",
    url: item.dataset.linkUrl || ""
  }));
  const fromIndex = visibleLinks.findIndex((link) => link.id === draggedId);
  const toIndex = visibleLinks.findIndex((link) => link.id === targetId);

  if (fromIndex < 0 || toIndex < 0) {
    return;
  }

  const [moved] = visibleLinks.splice(fromIndex, 1);
  visibleLinks.splice(toIndex, 0, moved);

  const existingCustomLinks = normalizeQuickLinks(state.app.quickLinks);
  const customById = new Map(existingCustomLinks.map((link) => [link.id, link]));
  const customByUrl = new Map(existingCustomLinks.map((link) => [link.url, link]));
  const nextCustomLinks = [];

  for (const visibleLink of visibleLinks.slice(0, MAX_CUSTOM_QUICK_LINKS)) {
    let customLink = customById.get(visibleLink.id) || customByUrl.get(visibleLink.url);

    if (!customLink && visibleLink.source === "recommended") {
      customLink = promoteRecommendationToQuickLink(visibleLink, nextCustomLinks);
      state.app.dismissedRecommendationUrls = uniqueUrls([
        ...(state.app.dismissedRecommendationUrls || []),
        visibleLink.url
      ]);
    }

    if (customLink && !nextCustomLinks.some((link) => link.url === customLink.url)) {
      nextCustomLinks.push({
        ...customLink,
        order: nextCustomLinks.length
      });
    }
  }

  state.app.quickLinks = normalizeQuickLinks(nextCustomLinks);
  await saveState(state.app);
  await renderQuickLinks();
}

function closeShortcutModal() {
  elements.shortcutModal.hidden = true;
  elements.shortcutForm.reset();
  state.editingShortcutId = "";
}

async function saveShortcutFromForm(event) {
  event.preventDefault();

  const title = elements.shortcutTitle.value.trim();
  const url = elements.shortcutUrl.value.trim();

  if (!title || !url || !isValidNavigableUrl(url)) {
    elements.shortcutUrl.focus();
    return;
  }

  const existing = normalizeQuickLinks(state.app.quickLinks);
  const editedId = elements.shortcutId.value;
  const withoutEdited = existing.filter((link) => link.id !== editedId);
  const quickLink = createQuickLink({ id: editedId || undefined, title, url }, withoutEdited);

  state.app.quickLinks = editedId
    ? existing.map((link) => (link.id === editedId ? { ...quickLink, order: link.order } : link))
    : [...existing, quickLink].slice(0, MAX_CUSTOM_QUICK_LINKS);

  state.app.quickLinks = normalizeQuickLinks(state.app.quickLinks);
  await saveState(state.app);
  await renderQuickLinks();
  closeShortcutModal();
}

async function deleteEditingShortcut() {
  const editedId = elements.shortcutId.value;
  if (!editedId) {
    return;
  }

  state.app.quickLinks = normalizeQuickLinks(state.app.quickLinks).filter((link) => link.id !== editedId);
  await saveState(state.app);
  await renderQuickLinks();
  closeShortcutModal();
}

function openSettingsModal() {
  elements.customGreetingName.value = state.app.settings.customGreetingName || "";
  elements.historyAutocomplete.checked = Boolean(state.app.settings.historyAutocomplete);
  elements.settingsModal.hidden = false;
  elements.customGreetingName.focus();
}

function closeSettingsModal() {
  elements.settingsModal.hidden = true;
  elements.settingsForm.reset();
}

async function saveSettingsFromForm(event) {
  event.preventDefault();
  state.app.settings.customGreetingName = elements.customGreetingName.value.trim();
  state.app.settings.historyAutocomplete = elements.historyAutocomplete.checked;
  await saveState(state.app);
  renderGreeting();
  closeSettingsModal();
  await renderQuickLinks();
  suggestionDebouncer();
}

async function resetDismissedRecommendations() {
  state.app.dismissedRecommendationUrls = [];
  state.skippedRecommendationUrls = [];
  await saveState(state.app);
  await renderQuickLinks();
}

function closeModalOnBackdrop(event) {
  if (event.target === elements.shortcutModal) {
    closeShortcutModal();
  }

  if (event.target === elements.settingsModal) {
    closeSettingsModal();
  }
}

function faviconFor(url) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(getHostname(normalizeUrl(url)))}&sz=64`;
}

function renderIcon(container, value) {
  if (String(value).startsWith("http")) {
    const image = document.createElement("img");
    image.src = value;
    image.alt = "";
    image.addEventListener("error", () => {
      image.remove();
      container.textContent = "↗";
    });
    container.append(image);
    return;
  }

  container.textContent = value;
}

function isValidNavigableUrl(url) {
  try {
    return isWebQuickLinkUrl(url);
  } catch {
    return false;
  }
}

function debounce(fn, delay) {
  let timer = 0;

  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
