export async function getProfileEmail() {
  if (!globalThis.chrome?.identity?.getProfileUserInfo) {
    return "";
  }

  return new Promise((resolve) => {
    try {
      globalThis.chrome.identity.getProfileUserInfo((profile) => {
        resolve(profile?.email || "");
      });
    } catch {
      resolve("");
    }
  });
}

export function getGreetingName(settings, profileEmail) {
  return settings?.customGreetingName?.trim() || profileEmail || "there";
}

