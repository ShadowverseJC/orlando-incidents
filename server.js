/**
 * Orlando / Winter Park Incident Map — Backend Server
 * ----------------------------------------------------
 * Run:  node server.js
 * Then: open http://localhost:3000
 *
 * ALL DATA SOURCES ARE LIVE AND FREE — NO EXTERNAL GEOCODING:
 *   /api/police    → OPD Active CAD (live police calls)
 *   /api/fire      → OPD Active CAD (live fire/EMS calls)
 *   /api/traffic   → FHP Live CAD   (live crashes, Orange + Seminole counties)
 *   /api/weather   → NWS            (live weather alerts, Orange County)
 *   /api/community → SeeClickFix    (citizen reports)
 *   /api/all       → all of the above combined
 */

const express  = require('express');
const cors     = require('cors');
const xml2js   = require('xml2js');
const path     = require('path');
const { geocode } = require('./geocoder');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ── Structured logger ─────────────────────────────────────────────
function log(level, source, msg, meta = {}) {
  const entry = {
    ts:     new Date().toISOString(),
    level,
    source,
    msg,
    ...meta,
  };
  // Pretty print in dev, JSON in prod for log aggregators (Logtail, Papertrail etc.)
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(entry));
  } else {
    const icon = level === 'error' ? '✗' : level === 'warn' ? '⚠' : '✓';
    console.log(`${icon} [${source}] ${msg}`, Object.keys(meta).length ? meta : '');
  }
}

// ── Cache ──────────────────────────────────────────────────────────
const cache = {};
function getCache(key) {
  const e = cache[key];
  if (!e || Date.now() - e.ts > e.ttl) return null;
  return e.data;
}
function setCache(key, data, ttlMs) {
  cache[key] = { data, ts: Date.now(), ttl: ttlMs };
}

// ── Fetch with timeout ─────────────────────────────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Orlando/Winter Park bounding box for pin validation
function inArea(lat, lng) {
  return lat >= 28.35 && lat <= 28.75 && lng >= -81.60 && lng <= -81.10;
}

// ── /api/police ────────────────────────────────────────────────────
// Source: OPD Active CAD XML feed (live, public, no key)
// Cache: 2 minutes
app.get('/api/police', async (req, res) => {
  const cached = getCache('police');
  if (cached) return res.json(cached);

  const SEV_HIGH   = /battery|armed|shooting|robbery|assault|homicide|stabbing/i;
  const SEV_MEDIUM = /disturbance|threat|suspicious|drug|burglary|theft|fight/i;

  try {
    const r = await fetchWithTimeout(
      'https://www1.cityoforlando.net/opd/activecalls/activecadpolice.xml',
      { headers: { 'User-Agent': 'OrlandoIncidentMap/1.0 (contact@yoursite.com)' } }
    );
    if (!r.ok) throw new Error(`OPD police CAD returned ${r.status}`);

    const xml   = await r.text();
    const data  = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const calls = [].concat(data?.CALLS?.CALL || []);

    const incidents = calls
      .map(c => {
        const loc    = c.LOCATION || '';
        const desc   = c.DESC     || 'Police call';
        const date   = c.DATE     || '—';
        const time   = date.includes(' ') ? date.split(' ')[1] : date;
        const coords = geocode(loc, c.DISTRICT);
        if (!inArea(coords.lat, coords.lng)) return null;
        return {
          id:     `opd-${c.$.incident}`,
          type:   'crime',
          title:  desc,
          addr:   loc,
          lat:    coords.lat,
          lng:    coords.lng,
          sev:    SEV_HIGH.test(desc) ? 'high' : SEV_MEDIUM.test(desc) ? 'medium' : 'low',
          status: 'active',
          time,
          src:    'OPD Active CAD',
          detail: { Type: desc, Location: loc, Incident: c.$.incident, District: c.DISTRICT || '—' }
        };
      })
      .filter(Boolean);

    log('info', 'police', `${calls.length} calls → ${incidents.length} mapped`, { source: 'OPD CAD' });
    setCache('police', incidents, 2 * 60 * 1000);
    res.json(incidents);

  } catch (err) {
    log('error', 'police', err.message);
    res.json([]);
  }
});

// ── /api/fire ─────────────────────────────────────────────────────
// Source: OPD Active CAD fire/EMS XML feed (live, public, no key)
// Cache: 2 minutes
app.get('/api/fire', async (req, res) => {
  const cached = getCache('fire');
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      'https://www1.cityoforlando.net/opd/activecalls/activecadfire.xml',
      { headers: { 'User-Agent': 'OrlandoIncidentMap/1.0 (contact@yoursite.com)' } }
    );
    if (!r.ok) throw new Error(`OPD fire CAD returned ${r.status}`);

    const xml   = await r.text();
    const data  = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const calls = [].concat(data?.CALLS?.CALL || []);

    const incidents = calls
      .map(c => {
        const loc    = c.LOCATION || '';
        const desc   = c.DESC     || 'Fire/EMS call';
        const date   = c.DATE     || '—';
        const time   = date.includes(' ') ? date.split(' ')[1] : date;
        const coords = geocode(loc, c.DISTRICT);
        if (!inArea(coords.lat, coords.lng)) return null;
        return {
          id:     `fire-${c.$.incident}`,
          type:   'fire',
          title:  desc,
          addr:   loc,
          lat:    coords.lat,
          lng:    coords.lng,
          sev:    /fire|cardiac|trauma|structure/i.test(desc) ? 'high' : 'medium',
          status: 'active',
          time,
          src:    'OPD Active CAD (Fire/EMS)',
          detail: { Type: desc, Location: loc, Incident: c.$.incident, District: c.DISTRICT || '—' }
        };
      })
      .filter(Boolean);

    log('info', 'fire', `${calls.length} calls → ${incidents.length} mapped`, { source: 'OPD CAD' });
    setCache('fire', incidents, 2 * 60 * 1000);
    res.json(incidents);

  } catch (err) {
    log('error', 'fire', err.message);
    res.json([]);
  }
});

// ── /api/traffic ──────────────────────────────────────────────────
// Source: FHP Live Traffic CAD (live, public, lat/lng included)
// Filters to Orange and Seminole counties — covers Orlando + Winter Park.
// Cache: 3 minutes
app.get('/api/traffic', async (req, res) => {
  const cached = getCache('traffic');
  if (cached) return res.json(cached);

  try {
    const r = await fetchWithTimeout(
      'https://trafficincidents.flhsmv.gov/SmartWebClient/CadView.aspx',
      { headers: { 'User-Agent': 'OrlandoIncidentMap/1.0 (contact@yoursite.com)' } }
    );
    if (!r.ok) throw new Error(`FHP CAD returned ${r.status}`);

    const html = await r.text();

    // Parse the HTML table rows — each row contains incident data
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const rows = html.match(rowRegex) || [];

    const incidents = [];
    for (const row of rows) {
      const cells = [];
      let m;
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((m = cellRe.exec(row)) !== null) {
        cells.push(m[1].replace(/<[^>]+>/g, '').trim());
      }
      // FHP table columns: Type, Received, Dispatched, Arrived, County, Location, Remarks, Lat, Lng
      if (cells.length < 9) continue;

      const county = cells[4]?.toUpperCase() || '';
      if (!county.includes('ORANGE') && !county.includes('SEMINOLE')) continue;

      const lat = parseFloat(cells[7]);
      const lng = parseFloat(cells[8]);
      if (isNaN(lat) || isNaN(lng)) continue;

      const type    = cells[0] || 'Traffic incident';
      const loc     = cells[5] || '—';
      const remarks = cells[6] || '—';
      const recvd   = cells[1] || '—';
      const time    = recvd.includes(' ') ? recvd.split(' ')[1] : recvd;

      const sev = /injury|injuries|fatality|roadblock|blocked/i.test(`${type} ${remarks}`) ? 'high'
                : /hit and run|crash/i.test(type) ? 'medium' : 'low';

      incidents.push({
        id:     `fhp-${incidents.length}`,
        type:   'traffic',
        title:  type,
        addr:   loc,
        lat, lng,
        sev,
        status: 'active',
        time,
        src:    'FHP Live CAD',
        detail: { County: county, Location: loc, Remarks: remarks, Received: recvd }
      });
    }

    log('info', 'traffic', `${incidents.length} incidents in Orange/Seminole counties`);
    setCache('traffic', incidents, 3 * 60 * 1000);
    res.json(incidents);

  } catch (err) {
    log('error', 'traffic', err.message);
    res.json([]);
  }
});

// ── /api/weather ──────────────────────────────────────────────────
// Source: NWS api.weather.gov — Orange County zone FLZ042
// Cache: 10 minutes
app.get('/api/weather', async (req, res) => {
  const cached = getCache('weather');
  if (cached) return res.json(cached);

  const ORLANDO = [28.5383, -81.3792];
  try {
    const r = await fetchWithTimeout(
      'https://api.weather.gov/alerts/active?zone=FLZ042',
      { headers: { 'User-Agent': 'OrlandoIncidentMap/1.0 (contact@yoursite.com)' } }
    );
    if (!r.ok) throw new Error(`NWS returned ${r.status}`);

    const data = await r.json();
    const incidents = (data.features || []).map((f, i) => {
      const p     = f.properties;
      const onset = p.onset
        ? new Date(p.onset).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : '—';
      return {
        id:     `nws-${i}`,
        type:   'weather',
        title:  p.event || 'Weather alert',
        addr:   p.areaDesc || 'Orange County',
        lat:    ORLANDO[0] + (Math.random() - 0.5) * 0.1,
        lng:    ORLANDO[1] + (Math.random() - 0.5) * 0.1,
        sev:    p.severity === 'Extreme' ? 'high' : p.severity === 'Severe' ? 'medium' : 'low',
        status: p.status === 'Actual' ? 'active' : 'resolved',
        time:   onset,
        src:    'NWS / weather.gov',
        detail: { Event: p.event, Certainty: p.certainty, Urgency: p.urgency,
                  Expires: p.expires ? new Date(p.expires).toLocaleString() : '—' }
      };
    });

    log('info', 'weather', `${incidents.length} active alerts`);
    setCache('weather', incidents, 10 * 60 * 1000);
    res.json(incidents);

  } catch (err) {
    log('error', 'weather', err.message);
    res.json([]);
  }
});

// ── /api/community ────────────────────────────────────────────────
// Source: SeeClickFix public API — citizen reports for Orlando area
// Cache: 30 minutes
app.get('/api/community', async (req, res) => {
  const cached = getCache('community');
  if (cached) return res.json(cached);

  // Orlando bounding box
  const params = new URLSearchParams({
    min_lat: '28.42', min_lng: '-81.55',
    max_lat: '28.68', max_lng: '-81.20',
    per_page: '100', page: '1',
    sort: 'updated_at', direction: 'DESC',
  });

  try {
    const r = await fetchWithTimeout(
      `https://seeclickfix.com/api/v2/issues?${params}`,
      { headers: { 'User-Agent': 'OrlandoIncidentMap/1.0 (contact@yoursite.com)' } }
    );
    if (!r.ok) throw new Error(`SeeClickFix returned ${r.status}`);

    const data   = await r.json();
    const issues = (data.issues || []).filter(i => i.lat && i.lng);

    const incidents = issues.map((i, idx) => {
      const date = i.created_at
        ? new Date(i.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '—';
      const time = i.created_at
        ? new Date(i.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : '—';
      return {
        id:     `scf-${i.id || idx}`,
        type:   'community',
        title:  i.summary || i.request_type?.title || 'Community report',
        addr:   i.address || 'Orlando, FL',
        lat:    parseFloat(i.lat),
        lng:    parseFloat(i.lng),
        sev:    (i.rating || 0) >= 10 ? 'high' : (i.rating || 0) >= 3 ? 'medium' : 'low',
        status: i.status === 'Closed' ? 'resolved' : 'active',
        time:   `${date} ${time}`,
        src:    'SeeClickFix',
        detail: { Type: i.request_type?.title || '—', Status: i.status || '—',
                  Reported: date, Votes: i.rating || 0, Comments: i.comment_count || 0 }
      };
    });

    log('info', 'community', `${incidents.length} issues`);
    setCache('community', incidents, 30 * 60 * 1000);
    res.json(incidents);

  } catch (err) {
    log('error', 'community', err.message);
    res.json([]);
  }
});

// ── /api/all ──────────────────────────────────────────────────────
app.get('/api/all', async (req, res) => {
  const BASE = `http://localhost:${PORT}`;
  const results = await Promise.allSettled([
    fetch(`${BASE}/api/police`).then(r => r.json()),
    fetch(`${BASE}/api/fire`).then(r => r.json()),
    fetch(`${BASE}/api/traffic`).then(r => r.json()),
    fetch(`${BASE}/api/weather`).then(r => r.json()),
    fetch(`${BASE}/api/community`).then(r => r.json()),
  ]);
  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  res.json(all);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🗺  Orlando / Winter Park Incident Map`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   All data sources: LIVE\n`);
});
