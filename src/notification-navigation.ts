function validDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

/** Retained across authentication; only a new date selection or Latest replaces it. */
export function createNotificationNavigation(search: string) {
  const params = new URLSearchParams(search);
  const single = (key: string) => params.getAll(key).length === 1 ? params.get(key) : null;
  let date = validDate(single('date'));
  const player = single('player');
  return {
    forceLive: ['date', 'player', 'latest'].some(key => params.has(key)),
    playerId: player && /^[1-9]\d{0,11}$/.test(player) ? player : undefined,
    get date() { return date; },
    dashboardPath: () => `/api/dashboard${date ? `?date=${date}` : ''}`,
    selectDate: (value: string) => { date = validDate(value); },
    openLatest: () => { date = undefined; },
  };
}

/** Reads an existing subscription only: this action never asks permission or subscribes. */
export async function sendCurrentDeviceTest(permission: NotificationPermission, getSubscription: () => Promise<{ endpoint: string } | null>, send: (endpoint: string) => Promise<void>) {
  if (permission === 'denied') throw new Error('Allow notifications in browser or app settings, then enable bedtime notifications.');
  if (permission !== 'granted') throw new Error('Enable bedtime notifications first.');
  const subscription = await getSubscription();
  if (!subscription?.endpoint) throw new Error('Enable bedtime notifications first.');
  await send(subscription.endpoint);
}
