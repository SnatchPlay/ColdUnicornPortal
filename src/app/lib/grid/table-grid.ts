/**
 * Entity-agnostic grid helpers for dense, banded, sticky-column tables (the mega-table pattern,
 * generalized). Pure — no React — so they are unit-testable and reusable by `LeadCrmTable` and,
 * later, a converged clients grid. Phase 3 (ADR-0013).
 */

export interface StageBand<S extends string> {
  stage: S;
  label: string;
  /** Number of consecutive columns in this band. */
  span: number;
  /** Index of the band's first column in the flat column list. */
  startIndex: number;
}

/**
 * Group a flat, stage-ordered column list into consecutive bands (the grouped stage strip). Columns
 * must already be ordered by stage — consecutive same-stage columns collapse into one band.
 */
export function computeStageBands<S extends string, T extends { stage: S }>(
  columns: T[],
  labelOf: (stage: S) => string,
): StageBand<S>[] {
  const bands: StageBand<S>[] = [];
  columns.forEach((col, index) => {
    const last = bands[bands.length - 1];
    if (last && last.stage === col.stage) last.span += 1;
    else bands.push({ stage: col.stage, label: labelOf(col.stage), span: 1, startIndex: index });
  });
  return bands;
}

/**
 * Cumulative `left` offsets (px) for the first `count` sticky columns, so each sticky column pins
 * just to the right of the previous one. `offsets[i]` = sum of the widths before column `i`.
 */
export function stickyLeftOffsets(widths: number[], count: number): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < count; i += 1) {
    offsets.push(acc);
    acc += widths[i] ?? 0;
  }
  return offsets;
}
