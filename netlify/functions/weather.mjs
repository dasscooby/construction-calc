// Pour-day weather for a job address: finds the address (OpenStreetMap), then the 7-day forecast
// (Open-Meteo). Both are free and need no key. Temperatures °F, wind mph.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=1800' },
  });

async function find(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us,ca&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'user-agent': 'ConstructionCalc/1.1 (construction-calc-7815.netlify.app)' } });
  if (!res.ok) return null;
  const hits = await res.json();
  return hits?.[0] ? { lat: Number(hits[0].lat), lon: Number(hits[0].lon), place: String(hits[0].display_name).split(',').slice(0, 3).join(',') } : null;
}

export default async (req) => {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 200);
  if (!q) return json({ error: 'Add the job address first.' }, 400);
  // Full street address first; if that misses, try just the town (the last parts of the address).
  let at = await find(q);
  if (!at && q.includes(',')) at = await find(q.split(',').slice(-2).join(','));
  if (!at) return json({ error: 'Couldn’t find that address. Try adding the town and state.' }, 404);
  const f = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lon}` +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7',
  );
  if (!f.ok) return json({ error: 'Weather isn’t available right now. Try again in a bit.' }, 502);
  const d = (await f.json()).daily;
  const days = d.time.map((date, i) => ({
    date,
    hi: Math.round(d.temperature_2m_max[i]),
    lo: Math.round(d.temperature_2m_min[i]),
    rain: Math.round(d.precipitation_probability_max[i] ?? 0),
    wind: Math.round(d.wind_speed_10m_max[i]),
  }));
  return json({ place: at.place, days });
};
