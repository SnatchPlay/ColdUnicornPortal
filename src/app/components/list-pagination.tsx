import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";
import { buildPageWindow } from "../lib/pagination";

/** The portal's paged-list control: previous / first + ellipsis / window / ellipsis + last / next.
 *  One implementation for every paged surface (leads grid, Team users) — the edge cases here
 *  (which ellipsis shows, when the arrows go inert) are exactly what drifts when it is copied.
 *  `page` must already be clamped to `[1, totalPages]` — use `clampPage` from `lib/pagination`. */
export function ListPagination({
  page,
  totalPages,
  onPageChange,
  className = "mx-0 w-auto justify-start",
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const pageWindow = buildPageWindow(page, totalPages);
  const first = pageWindow[0];
  const last = pageWindow[pageWindow.length - 1];

  return (
    <Pagination className={className}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            onClick={(e) => { e.preventDefault(); if (page > 1) onPageChange(page - 1); }}
            className={page <= 1 ? "pointer-events-none opacity-40" : ""}
          />
        </PaginationItem>
        {first && first > 1 ? (
          <>
            <PaginationItem><PaginationLink href="#" onClick={(e) => { e.preventDefault(); onPageChange(1); }}>1</PaginationLink></PaginationItem>
            {first > 2 ? <PaginationItem><PaginationEllipsis /></PaginationItem> : null}
          </>
        ) : null}
        {pageWindow.map((entry) => (
          <PaginationItem key={entry}>
            <PaginationLink href="#" isActive={entry === page} onClick={(e) => { e.preventDefault(); onPageChange(entry); }}>{entry}</PaginationLink>
          </PaginationItem>
        ))}
        {last && last < totalPages ? (
          <>
            {last < totalPages - 1 ? <PaginationItem><PaginationEllipsis /></PaginationItem> : null}
            <PaginationItem><PaginationLink href="#" onClick={(e) => { e.preventDefault(); onPageChange(totalPages); }}>{totalPages}</PaginationLink></PaginationItem>
          </>
        ) : null}
        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={(e) => { e.preventDefault(); if (page < totalPages) onPageChange(page + 1); }}
            className={page >= totalPages ? "pointer-events-none opacity-40" : ""}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
