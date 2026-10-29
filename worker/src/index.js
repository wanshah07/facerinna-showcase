/* facerinna-visitors: a page-view collector and its read API.
 *
 *   POST /hit            from the public pages: {p: path, r: referrer}
 *   GET  /stats?...      Authorization: Bearer <STATS_KEY>  -> JSON for the admin dashboard
 *   GET  /export.csv?... Authorization: Bearer <STATS_KEY>  -> the filtered rows as CSV
 *   GET  /               a liveness line
 *
 * Filters on /stats and /export.csv: from, to (epoch ms or ISO), country (MY),
 * state (Selangor), path (/lucky-wheel.html). Everything is scoped to those.
 *
 * Privacy: no cookie, no browser storage, no IP stored. The visitor id is
 * sha256(ip | user agent | MYT day | SALT) cut to 16 hex, so the same phone is one
 * visitor for one day and nothing can be recovered from the hash.
 */

const MYT_OFFSET = 8 * 3600 * 1000;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|monitor|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python-requests/i;
const MAX_ROWS = 50000;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = corsFor(origin, env, url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/hit' && req.method === 'POST') return await hit(req, env, ctx, cors);
      if (url.pathname === '/stats' && req.method === 'GET') return await guarded(req, env, () => stats(url, env));
      if (url.pathname === '/export.csv' && req.method === 'GET') return await guarded(req, env, () => exportCsv(url, env));
      if (url.pathname === '/') return json({ ok: true, service: 'facerinna visitors', at: Date.now() });
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 500, cors);
    }
  }
};

function corsFor(origin, env, url) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const dev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && /localhost|127\.0\.0\.1/.test(url.hostname);
  const ok = allowed.includes(origin) || dev;
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}

async function guarded(req, env, fn) {
  const auth = req.headers.get('Authorization') || '';
  const key = auth.replace(/^Bearer\s+/i, '');
  if (!env.STATS_KEY || key !== env.STATS_KEY) return json({ ok: false, error: 'no key' }, 401);
  return fn();
}

/* ---- collecting ------------------------------------------------------- */

async function hit(req, env, ctx, cors) {
  const ua = req.headers.get('User-Agent') || '';
  if (BOT_RE.test(ua)) return new Response(null, { status: 204, headers: cors });
  let body = {};
  try { body = await req.json(); } catch (e) { /* sendBeacon may send text */ }
  const path = cleanPath(body.p);
  if (!path) return new Response(null, { status: 204, headers: cors });
  const now = Date.now();
  const cf = req.cf || {};
  const ip = req.headers.get('CF-Connecting-IP') || '';
  const day = mytDay(now);
  const vid = await visitorId(ip, ua, day, env.SALT || '');
  const row = {
    ts: now, day, vid, path,
    ref: refHost(body.r),
    country: cf.country || null,
    state: cf.region || null,
    city: cf.city || null,
    device: deviceOf(ua), browser: browserOf(ua), os: osOf(ua)
  };
  const stmt = env.DB.prepare(
    'INSERT INTO hits (ts, day, vid, path, ref, country, state, city, device, browser, os) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(row.ts, row.day, row.vid, row.path, row.ref, row.country, row.state, row.city, row.device, row.browser, row.os);
  ctx.waitUntil(stmt.run());
  return new Response(null, { status: 204, headers: cors });
}

function cleanPath(p) {
  p = String(p || '').split('?')[0].split('#')[0];
  if (!p.startsWith('/') || p.length > 200) return null;
  return p.replace(/\/index\.html$/, '/');
}
function refHost(r) {
  try { const h = new URL(String(r || '')).hostname; return h && h !== 'my.facerinna.com' ? h.replace(/^www\./, '') : null; }
  catch (e) { return null; }
}
function mytDay(ms) { return new Date(ms + MYT_OFFSET).toISOString().slice(0, 10); }
async function visitorId(ip, ua, day, salt) {
  const data = new TextEncoder().encode([ip, ua, day, salt].join('|'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
function deviceOf(ua) {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|Android|IEMobile|Opera Mini/i.test(ua)) return 'phone';
  return 'desktop';
}
function browserOf(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'Facebook app';
  if (/Instagram/.test(ua)) return 'Instagram app';
  if (/TikTok|BytedanceWebview|musical_ly/i.test(ua)) return 'TikTok app';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  if (/Chromium/.test(ua)) return 'Chromium';
  return 'Other';
}
function osOf(ua) {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}

/* ---- reading ---------------------------------------------------------- */

function parseFilters(url) {
  const q = url.searchParams;
  const now = Date.now();
  const toMs = v => { if (!v) return null; const n = Number(v); if (Number.isFinite(n) && n > 1e12) return n; const d = Date.parse(v); return Number.isFinite(d) ? d : null; };
  const from = toMs(q.get('from')) ?? (now - 7 * 86400000);
  const to = toMs(q.get('to')) ?? now;
  const where = ['ts >= ?', 'ts <= ?']; const args = [from, to];
  const country = (q.get('country') || '').trim().toUpperCase();
  const state = (q.get('state') || '').trim();
  const path = (q.get('path') || '').trim();
  if (country) { where.push('country = ?'); args.push(country); }
  if (state) { where.push('state = ?'); args.push(state); }
  if (path) { where.push('path = ?'); args.push(path); }
  return { from, to, country, state, path, where: where.join(' AND '), args };
}

async function stats(url, env) {
  const f = parseFilters(url);
  const db = env.DB;
  const W = f.where, A = f.args;
  const span = f.to - f.from;
  const bucketMs = span <= 2 * 86400000 ? 3600000 : 86400000;    // hourly up to 2 days, daily beyond
  const top = (col, n = 12) => db.prepare(
    `SELECT ${col} AS k, COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ${W} AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY views DESC LIMIT ${n}`
  ).bind(...A).all().then(r => r.results);
  const now = Date.now();
  const [totals, series, byCountry, byState, byCity, byPath, byRef, byDevice, byBrowser, byOs, live, recent, firstRow] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ${W}`).bind(...A).first(),
    db.prepare(`SELECT ((ts + ${MYT_OFFSET}) / ${bucketMs}) * ${bucketMs} - ${MYT_OFFSET} AS t, COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ${W} GROUP BY t ORDER BY t`).bind(...A).all().then(r => r.results),
    top('country', 60),
    db.prepare(`SELECT state AS k, COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ${W} AND country = 'MY' AND state IS NOT NULL GROUP BY state ORDER BY views DESC`).bind(...A).all().then(r => r.results),
    db.prepare(`SELECT city AS k, state, country, COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ${W} AND city IS NOT NULL GROUP BY city, state, country ORDER BY views DESC LIMIT 15`).bind(...A).all().then(r => r.results),
    top('path', 30),
    top('ref', 15),
    top('device', 5),
    top('browser', 10),
    top('os', 8),
    db.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ts >= ?`).bind(now - 5 * 60000).first(),
    db.prepare(`SELECT ts, path, ref, country, state, city, device, browser FROM hits WHERE ${W} ORDER BY ts DESC LIMIT 50`).bind(...A).all().then(r => r.results),
    db.prepare(`SELECT MIN(ts) AS first FROM hits`).first()
  ]);
  return json({
    ok: true, at: now, filters: { from: f.from, to: f.to, country: f.country, state: f.state, path: f.path }, bucketMs,
    totals, series, byCountry, byState, byCity, byPath, byRef, byDevice, byBrowser, byOs, live, recent,
    first: firstRow && firstRow.first || null
  });
}

async function exportCsv(url, env) {
  const f = parseFilters(url);
  const rows = (await env.DB.prepare(
    `SELECT ts, day, path, ref, country, state, city, device, browser, os FROM hits WHERE ${f.where} ORDER BY ts DESC LIMIT ${MAX_ROWS}`
  ).bind(...f.args).all()).results;
  const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = 'time_myt,day,path,referrer,country,state,city,device,browser,os';
  const lines = rows.map(r => [new Date(r.ts + MYT_OFFSET).toISOString().replace('T', ' ').slice(0, 19), r.day, r.path, r.ref, r.country, r.state, r.city, r.device, r.browser, r.os].map(esc).join(','));
  return new Response([head, ...lines].join('\n') + '\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="facerinna-visitors.csv"', 'Cache-Control': 'no-store' }
  });
}
