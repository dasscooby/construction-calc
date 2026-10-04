// Reads a plan page (picture or PDF) with Claude and sends back what it found: slabs walked side by side,
// thickness, thickened edge, rebar and dowels, plus notes. The API key lives in the Netlify site's
// environment, never in the app: Netlify's AI Gateway fills in ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL
// (or set your own ANTHROPIC_API_KEY on the site).

const MODEL = 'claude-sonnet-5-5';
const MAX_BYTES = 4_500_000; // Netlify takes about 6 MB per request, base64 included

const SLAB_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'What the plan calls it, e.g. "Garage slab", "Patio"' },
    sides: {
      type: 'array',
      description:
        'Walk the slab edge CLOCKWISE with the slab on your right, starting at the top-left corner heading right. One entry per side, corner to corner as if every corner were square.',
      items: {
        type: 'object',
        properties: {
          length_ft: { type: 'number' },
          turn: { type: 'string', enum: ['R', 'L'], description: 'Turn at the END of this side: R = outside corner, L = inside (notch) corner' },
          radius_ft: { type: 'number', description: 'Corner radius at the end of this side, 0 if square' },
          edge: {
            type: 'string',
            enum: ['form', 'house', 'dowels', 'slab', 'slabDowels'],
            description: 'form = formed edge; house = poured against the house; dowels = against the house with dowels; slab = against existing slab; slabDowels = existing slab with dowels',
          },
        },
        required: ['length_ft', 'turn', 'radius_ft', 'edge'],
      },
    },
    thickness_in: { type: ['number', 'null'] },
    footing: {
      type: ['object', 'null'],
      description: 'Thickened edge / turned-down footing, if shown',
      properties: { width_in: { type: 'number' }, depth_in: { type: 'number', description: 'From top of slab to bottom of footing' } },
    },
    rebar: { type: ['object', 'null'], properties: { size: { type: 'integer' }, spacing_in: { type: 'number' } } },
    footing_bars: { type: ['object', 'null'], properties: { size: { type: 'integer' }, count: { type: 'integer' } } },
    dowels: { type: ['object', 'null'], properties: { size: { type: 'integer' }, spacing_in: { type: 'number' }, length_in: { type: 'number' } } },
  },
  required: ['name', 'sides'],
};

const TOOL = {
  name: 'plan_data',
  description: 'Report what the plan shows.',
  input_schema: {
    type: 'object',
    properties: {
      slabs: { type: 'array', items: SLAB_SCHEMA },
      notes: { type: 'array', items: { type: 'string' }, description: 'Other callouts a concrete crew needs: concrete strength, vapor barrier, base rock, mesh, joints, etc. Short, plain words.' },
      unsure: { type: 'array', items: { type: 'string' }, description: 'Anything you could not read or had to guess. Short.' },
    },
    required: ['slabs', 'notes', 'unsure'],
  },
};

const PROMPT = `You are reading a construction plan for a concrete foundation and slab crew.
Find every concrete slab or flatwork area with its dimensions and turn each into a clockwise walk of its sides.
Use the written dimensions, not measurements of the drawing. Feet and inches like 14'-6" are 14.5 ft.
If only overall length and width are given, it's a rectangle: 4 sides, all right turns.
Read slab thickness, thickened edge / footing size, rebar size and spacing (e.g. #4 @ 18" O.C.), footing bars, and dowels if shown.
Mark sides against an existing house or slab if the plan shows that. Leave values null when the plan doesn't say.
List what you had to guess in "unsure". Call plan_data once.`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' },
  });

export default async (req) => {
  if (req.method === 'OPTIONS') return json({});
  if (req.method !== 'POST') return json({ error: 'Send a plan page.' }, 405);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'Plan reading isn’t switched on yet.' }, 503);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'That file didn’t come through. Try again.' }, 400);
  }
  const { data, mediaType } = body ?? {};
  const okType = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mediaType);
  if (typeof data !== 'string' || !okType) return json({ error: 'Use a PDF or a picture (JPG or PNG).' }, 400);
  if ((data.length * 3) / 4 > MAX_BYTES) return json({ error: 'That file is too big. Try one page, or a smaller picture.' }, 413);

  const file =
    mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      tools: [TOOL],
      messages: [{ role: 'user', content: [file, { type: 'text', text: PROMPT }] }],
    }),
  });
  if (!res.ok) {
    const detail = `${res.status} ${(await res.text()).slice(0, 300)}`;
    console.error('read-plan', detail);
    return json({ error: 'Couldn’t read the plan right now. Try again in a minute.', detail }, 502);
  }
  const out = await res.json();
  const used = out.content?.find((c) => c.type === 'tool_use' && c.name === 'plan_data');
  if (!used) return json({ error: 'Couldn’t find slab info on that page.' }, 422);
  return json(used.input);
};
