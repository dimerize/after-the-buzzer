/** Competition ranking (1, 2, 2, 4) that keeps every row tied within the top `limit`. Ties break on `key` only for a stable order. */
export function rankTop<T extends { key: string }>(rows: T[], compare: (a: T, b: T) => number, limit = 10): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => compare(a, b) || a.key.localeCompare(b.key));
  const ranked: (T & { rank: number })[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const rank = index > 0 && compare(sorted[index - 1], sorted[index]) === 0 ? ranked[index - 1].rank : index + 1;
    if (rank > limit) break;
    ranked.push({ ...sorted[index], rank });
  }
  return ranked;
}

/** Exact per-game ordering from integer totals (no rounded averages). */
export const byAverage = <T extends { total: number; games: number }>(a: T, b: T) => b.total * a.games - a.total * b.games;
export const byTotal = <T extends { total: number }>(a: T, b: T) => b.total - a.total;
