// Watchlist — the listings a buyer is actively tracking.
//
// Stored in localStorage: the static site has no accounts, and a shortlist is
// personal data that has no business leaving the device. Changes broadcast a
// `housescout:watchlist` event so every mounted component stays in sync.

const LS_KEY = "housescout.watchlist";
const EVENT = "housescout:watchlist";

/** Compare view stays readable up to four columns. */
export const MAX_COMPARE = 4;

export function getWatchlist(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function save(ids: number[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event(EVENT));
}

export function isWatched(id: number): boolean {
  return getWatchlist().includes(id);
}

export function toggleWatch(id: number): boolean {
  const ids = getWatchlist();
  const next = ids.includes(id) ? ids.filter((n) => n !== id) : [...ids, id];
  save(next);
  return next.includes(id);
}

export function removeWatch(id: number): void {
  save(getWatchlist().filter((n) => n !== id));
}

export function clearWatchlist(): void {
  save([]);
}

export const WATCHLIST_EVENT = EVENT;
