const https = require('https');

const GOOGLE_KEY  = process.env.GOOGLE_PLACES_KEY || 'AIzaSyA06QbgEjQqVfO0ak5_Zo_MKp_BDxBhuz0';
const SUPA_URL    = process.env.SUPABASE_URL       || 'https://knukfjvuwqckmnsyxozt.supabase.co';
const SUPA_KEY    = process.env.SUPABASE_KEY       || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudWtmanZ1d3Fja21uc3l4b3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0Mjc3NjAsImV4cCI6MjA5NzAwMzc2MH0.j_OgX2LB4kPkjl9P_JRBX0EGxepAC9ua64ksPvJdG8o';
const CO_KEY      = process.env.COMPANIES_OFFICE_KEY || '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function toHex(s)   { return Buffer.from(s, 'utf8').toString('hex'); }
function fromHex(h) { return Buffer.from(h, 'hex').toString('utf8'); }

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'KronosLeadFinder/2.0', Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
  });
}

function postData(hostname, path, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function basicResult(place) {
  return {
    place_id: place.place_id,
    name: place.name,
    phone: '',
    website: '',
    hasWebsite: false,
    rating: place.rating || 0,
    reviewCount: place.user_ratings_total || 0,
    address: place.formatted_address || '',
    isOpen: null,
    director: ''
  };
}

async function fetchDetails(place) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,rating,user_ratings_total,opening_hours,formatted_address,business_status&key=${GOOGLE_KEY}`;
    const d = await fetchUrl(url);
    if (!d.result) return basicResult(place);
    const r = d.result;
    return {
      place_id: place.place_id,
      name: r.name || place.name,
      phone: r.formatted_phone_number || '',
      website: r.website || '',
      hasWebsite: !!r.website,
      rating: r.rating || place.rating || 0,
      reviewCount: r.user_ratings_total || place.user_ratings_total || 0,
      address: r.formatted_address || place.formatted_address || '',
      isOpen: r.opening_hours?.open_now ?? null,
      director: ''
    };
  } catch(e) { return basicResult(place); }
}

async function getDirector(name) {
  if (!CO_KEY) return '';
  try {
    const data = await fetchUrl(
      `https://api.business.govt.nz/services/v5/company/search?q=${encodeURIComponent(name)}&apikey=${CO_KEY}`
    );
    const item = data.items?.[0];
    if (!item) return '';
    const dir = item.directors?.[0];
    return dir ? `${dir.firstName || ''} ${dir.lastName || ''}`.trim() : '';
  } catch(e) { return ''; }
}

function upsertSupabase(rows) {
  try {
    const u = new URL(SUPA_URL);
    postData(u.hostname, '/rest/v1/leads', {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    }, rows).catch(() => {});
  } catch(e) {}
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, location, radius = '20000', cursor } = req.query;

  try {
    let searchData;

    if (cursor) {
      let token;
      try { token = fromHex(cursor); } catch(e) { return res.status(400).json({ error: 'Invalid cursor' }); }
      await sleep(2000);
      searchData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(token)}&key=${GOOGLE_KEY}`
      );
      if (searchData.status === 'INVALID_REQUEST') {
        return res.status(200).json({ results: [], cursor: null, error: 'Page expired — please search again' });
      }
    } else {
      if (!query || !location) return res.status(400).json({ error: 'Missing query or location' });

      // Try geocoding for radius filtering — fall back to text-only if Geocoding API unavailable
      let locationParam = '';
      try {
        const geoData = await fetchUrl(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location + ', New Zealand')}&key=${GOOGLE_KEY}`
        );
        if (geoData.results?.length) {
          const { lat, lng } = geoData.results[0].geometry.location;
          locationParam = `&location=${lat},${lng}&radius=${parseInt(radius) || 20000}`;
        }
      } catch(e) { /* geocoding optional — proceed without lat/lng */ }

      searchData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + location + ' New Zealand')}${locationParam}&key=${GOOGLE_KEY}`
      );
    }

    if (!searchData.results?.length) {
      return res.status(200).json({ results: [], cursor: null, total: 0, googleStatus: searchData.status });
    }

    const places = searchData.results.slice(0, 20);
    const nextCursor = searchData.next_page_token ? toHex(searchData.next_page_token) : null;

    // Fetch details in parallel batches of 5
    const detailed = [];
    for (let i = 0; i < places.length; i += 5) {
      const batch = places.slice(i, i + 5);
      const results = await Promise.all(batch.map(p => fetchDetails(p)));
      detailed.push(...results);
    }

    // Companies Office director lookup (parallel, only if key set)
    if (CO_KEY) {
      const directors = await Promise.all(detailed.map(b => getDirector(b.name)));
      directors.forEach((d, i) => { detailed[i].director = d; });
    }

    // Upsert to Supabase (fire and forget — don't block response)
    upsertSupabase(detailed.map(b => ({
      place_id: b.place_id,
      name: b.name,
      phone: b.phone,
      website: b.website,
      has_website: b.hasWebsite,
      rating: b.rating,
      review_count: b.reviewCount,
      address: b.address,
      director_name: b.director,
      search_query: query || '',
      search_location: location || ''
    })));

    return res.status(200).json({ results: detailed, cursor: nextCursor, total: searchData.results.length });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
