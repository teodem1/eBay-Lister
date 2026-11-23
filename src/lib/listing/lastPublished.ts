/**
 * The listing just published, handed from the listing screen to the main
 * screen (which shows "Published" once). sessionStorage: this tab only.
 */
export interface LastPublished {
  listingId: string;
  url: string;
  title: string;
  promotionError?: string;
}

const KEY = "ebay-lister:last-published";

export function stashPublished(p: LastPublished): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: the main screen just won't show the notice.
  }
}

/** Reads and clears it, so the notice shows only once. */
export function takePublished(): LastPublished | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as LastPublished) : null;
  } catch {
    return null;
  }
}
