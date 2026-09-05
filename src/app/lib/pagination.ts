/** Client-side pagination maths shared by every paged list (leads, team users, …).
 *  Page numbers are 1-based; `totalPages` is always at least 1 for a rendered list. */

/** How many numbered page links a `<Pagination>` renders around the current page. */
export const MAX_PAGE_LINKS = 5;

/** Keep a page number inside `[1, totalPages]` — the guard for a page that outlived its filter. */
export function clampPage(page: number, totalPages: number) {
  if (totalPages <= 0) return 1;
  return Math.min(Math.max(page, 1), totalPages);
}

/** The window of page numbers to render, centred on `currentPage`. */
export function buildPageWindow(currentPage: number, totalPages: number) {
  if (totalPages <= MAX_PAGE_LINKS) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const radius = Math.floor(MAX_PAGE_LINKS / 2);
  const end = Math.min(totalPages, Math.max(1, currentPage - radius) + MAX_PAGE_LINKS - 1);
  const start = Math.max(1, end - MAX_PAGE_LINKS + 1);
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) pages.push(page);
  return pages;
}
