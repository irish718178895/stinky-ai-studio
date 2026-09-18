export function appUrl(url) {
  if (!url || !url.startsWith("/")) return url;
  const marker = "/missioncontrol/ai-studio/";
  const base = window.location.pathname.includes(marker) ? marker : "/";
  return base + url.slice(1);
}

export async function jsonFetch(url, options = {}) {
  const response = await fetch(appUrl(url), options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data;
}
