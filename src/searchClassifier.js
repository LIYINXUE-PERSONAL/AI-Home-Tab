const QUESTION_STARTERS = ["what", "why", "when", "which", "how"];
const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCALHOST_RE = /^localhost(?::\d+)?(?:\/.*)?$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/.*)?$/;
const DOMAIN_RE = /^(?!.*\s)(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i;

export function classifyInput(rawInput) {
  const input = normalizeInput(rawInput);

  if (!input) {
    return { type: "empty", input };
  }

  if (isUrlLike(input)) {
    return {
      type: "navigate",
      input,
      url: normalizeUrl(input)
    };
  }

  if (isQuestionLike(input)) {
    return { type: "ai", input };
  }

  return { type: "search", input };
}

export function normalizeInput(rawInput) {
  return String(rawInput || "").trim().replace(/\s+/g, " ");
}

export function isQuestionLike(input) {
  const normalized = normalizeInput(input).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.includes("?")) {
    return true;
  }

  return QUESTION_STARTERS.some((starter) => {
    return normalized === starter || normalized.startsWith(`${starter} `);
  });
}

export function isUrlLike(input) {
  const normalized = normalizeInput(input);
  return PROTOCOL_RE.test(normalized) || LOCALHOST_RE.test(normalized) || IPV4_RE.test(normalized) || DOMAIN_RE.test(normalized);
}

export function normalizeUrl(input) {
  const normalized = normalizeInput(input);

  if (PROTOCOL_RE.test(normalized)) {
    return normalized;
  }

  if (LOCALHOST_RE.test(normalized) || IPV4_RE.test(normalized)) {
    return `http://${normalized}`;
  }

  return `https://${normalized}`;
}

export function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

