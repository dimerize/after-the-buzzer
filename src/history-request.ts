export interface HistoryRequestState<T> {
  key: string | null;
  data: T | null;
  loading: boolean;
  error: string;
}

export function historyRequestKey(url: string | null, attempt: number): string | null {
  return url === null ? null : `${attempt}:${url}`;
}

/** Filter during render, before a changed request's passive effect runs. */
export function visibleHistoryRequest<T>(state: HistoryRequestState<T>, key: string | null): HistoryRequestState<T> {
  return state.key === key ? state : { key, data: null, loading: key !== null, error: '' };
}

export function historyForPlayer<T extends { playerId: string; season?: number }>(data: T | null, playerId: string, season?: number | null): T | null {
  return data?.playerId === playerId && (season === undefined || data.season === season) ? data : null;
}

export function formatHistoryUpdatedAt(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(date);
}
