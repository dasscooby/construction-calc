// Pour-day weather: the 7-day forecast for a job's address, and plain warnings for pouring.
// Hot and cold limits follow the usual hot- and cold-weather concreting practice (ACI 305 / 306):
// over 90°F concrete sets fast and dries out; at 40°F and below it has to be kept from freezing.

import { Platform } from 'react-native';

import type { Forecast } from './jobs';

const ENDPOINT = Platform.OS === 'web' ? '/.netlify/functions/weather' : 'https://construction-calc-7815.netlify.app/.netlify/functions/weather';

export async function fetchForecast(address: string): Promise<Forecast> {
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(address)}`);
  } catch {
    throw new Error('No signal. The last forecast stays saved in the job.');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<Forecast> & { error?: string };
  if (!res.ok || !Array.isArray(body.days)) throw new Error(body.error ?? 'Weather isn’t available right now.');
  return { at: Date.now(), place: body.place ?? address, days: body.days };
}

export type Day = Forecast['days'][number];

/** What to watch for on a pour day, in plain words. Empty = good pouring weather. */
export function pourWarnings(d: Day): string[] {
  const w: string[] = [];
  if (d.hi >= 90) w.push('Hot: it sets fast. Pour early and keep it wet.');
  if (d.lo <= 32) w.push('Freezing: blankets or heat, no pouring on frozen ground.');
  else if (d.lo <= 40) w.push('Cold night: cover it so it doesn’t freeze.');
  if (d.rain >= 50) w.push('Rain likely. Have plastic ready.');
  else if (d.rain >= 30) w.push('Chance of rain.');
  if (d.wind >= 20) w.push('Windy: the top dries fast.');
  return w;
}

export const dayName = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
};
