const https = require('https');

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
const SUPA_URL   = process.env.SUPABASE_URL;
const SUPA_KEY   = process.env.SUPABASE_KEY;
const CO_KEY     = process.env.COMPANIES_OFFICE_KEY || '';
const YELP_KEY   = process.env.YELP_API_KEY || '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchUrl(urlStr, extraHeaders) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    https.get({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'User-Agent': 'KronosLeadFinder/2.0',
        Accept: 'application/json',
        ...(extraHeaders || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
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
    director: '',
    source: 'google'
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
      director: '',
      source: 'google'
    };
  } catch(e) { return basicResult(place); }
}

async function fetchYelp(query, location) {
  if (!YELP_KEY) return [];
  try {
    const url = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(query)}&location=${encodeURIComponent(location + ' New Zealand')}&limit=10`;
    const data = await fetchUrl(url, { Authorization: `Bearer ${YELP_KEY}` });
    if (!data.businesses?.length) return [];
    return data.businesses.map(b => ({
      place_id: 'yelp_' + b.id,
      name: b.name,
      phone: b.phone || '',
      website: b.url || '',
      hasWebsite: !!b.url,
      rating: b.rating || 0,
      reviewCount: b.review_count || 0,
      address: b.location?.display_address?.join(', ') || '',
      isOpen: b.is_closed != null ? !b.is_closed : null,
      director: '',
      source: 'yelp'
    }));
  } catch(e) { return []; }
}

function mergeResults(googleResults, yelpResults) {
  const names = googleResults.map(g => g.name.toLowerCase().trim());
  const unique = yelpResults.filter(y => {
    const yn = y.name.toLowerCase().trim();
    return !names.some(gn => gn === yn || gn.includes(yn) || yn.includes(gn));
  });
  return [...googleResults, ...unique];
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

async function upsertToSupabase(places) {
  if (!SUPA_URL || !SUPA_KEY) return;
  return new Promise((resolve) => {
    const body = JSON.stringify(places);
    const url = new URL(`${SUPA_URL}/rest/v1/leads`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + '?on_conflict=place_id',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { console.log('Supabase status:', res.statusCode, data); resolve(res.statusCode); });
    });
    req.on('error', (e) => { console.error('Supabase error:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, location, pagetoken } = req.query;

  try {
    let searchData;

    if (pagetoken) {
      await sleep(2000);
      searchData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(pagetoken)}&key=${GOOGLE_KEY}`
      );
      if (searchData.status === 'INVALID_REQUEST' || !searchData.results?.length) {
        return res.status(200).json({ results: [], nextPageToken: null, error: 'No more results' });
      }
    } else {
      if (!query || !location) return res.status(400).json({ error: 'Missing query or location' });
      searchData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + location + ' new zealand')}&key=${GOOGLE_KEY}`
      );
    }

    if (!searchData.results?.length) {
      return res.status(200).json({ results: [], nextPageToken: null, googleStatus: searchData.status });
    }

    const places = searchData.results.slice(0, 20);
    const nextPageToken = searchData.next_page_token || null;

    // Fetch details in parallel batches of 5
    const detailed = [];
    for (let i = 0; i < places.length; i += 5) {
      const batch = places.slice(i, i + 5);
      const results = await Promise.all(batch.map(p => fetchDetails(p)));
      detailed.push(...results);
    }

    // Merge Yelp results only on page 1
    let merged = detailed;
    if (!pagetoken && query && location) {
      const yelpResults = await fetchYelp(query, location);
      merged = mergeResults(detailed, yelpResults);
    }

    // Companies Office director lookup (only if key set, only on page 1)
    if (CO_KEY && !pagetoken) {
      const directors = await Promise.all(merged.map(b => getDirector(b.name)));
      directors.forEach((d, i) => { merged[i].director = d; });
    }

    // Upsert to Supabase
    await upsertToSupabase(merged.map(b => ({
      place_id: b.place_id,
      name: b.name,
      phone: b.phone || null,
      email: null,
      website: b.website || null,
      has_website: b.hasWebsite,
      rating: b.rating || null,
      address: b.address || null,
      industry: query || '',
      location_searched: location || ''
    })));

    return res.status(200).json({ results: merged, nextPageToken, query, location });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
