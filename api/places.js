const https = require('https');

const GOOGLE_KEY  = process.env.GOOGLE_PLACES_KEY || 'AIzaSyA06QbgEjQqVfO0ak5_Zo_MKp_BDxBhuz0';
const SUPA_URL    = process.env.SUPABASE_URL       || 'https://knukfjvuwqckmnsyxozt.supabase.co';
const SUPA_KEY    = process.env.SUPABASE_KEY       || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudWtmanZ1d3Fja21uc3l4b3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0Mjc3NjAsImV4cCI6MjA5NzAwMzc2MH0.j_OgX2LB4kPkjl9P_JRBX0EGxepAC9ua64ksPvJdG8o';
const CO_KEY      = process.env.COMPANIES_OFFICE_KEY || '';

// Suburb rotation tables — page 1 uses index 0, page 2 uses index 1, etc.
const SUBURB_MAP = {
  'auckland':     ['Auckland CBD', 'Auckland North Shore', 'Auckland South Auckland', 'Auckland West', 'Auckland East'],
  'hamilton':     ['Hamilton', 'Hamilton East', 'Hamilton West', 'Frankton Hamilton', 'Te Rapa Hamilton'],
  'wellington':   ['Wellington CBD', 'Wellington Newtown', 'Wellington Karori', 'Lower Hutt', 'Porirua'],
  'christchurch': ['Christchurch CBD', 'Christchurch East', 'Christchurch Riccarton', 'Papanui Christchurch', 'Hornby Christchurch'],
  'tauranga':     ['Tauranga', 'Mount Maunganui', 'Papamoa', 'Bethlehem Tauranga', 'Greerton Tauranga'],
  'dunedin':      ['Dunedin', 'South Dunedin', 'Mosgiel', 'Dunedin North', 'Green Island Dunedin'],
  'palmerston':   ['Palmerston North', 'Palmerston North West', 'Palmerston North East', 'Roslyn Palmerston', 'Terrace End Palmerston'],
  'napier':       ['Napier', 'Hastings', 'Taradale Napier', 'Onekawa Napier', 'Clive Hawke\'s Bay'],
  'nelson':       ['Nelson', 'Richmond Nelson', 'Stoke Nelson', 'Tasman Nelson', 'Motueka'],
  'rotorua':      ['Rotorua', 'Rotorua East', 'Ngongotaha Rotorua', 'Holdens Bay Rotorua', 'Koutu Rotorua'],
};

function getLocationVariant(location, page) {
  const loc = location.toLowerCase().trim();
  for (const [city, suburbs] of Object.entries(SUBURB_MAP)) {
    if (loc.includes(city)) {
      const idx = (page - 1) % suburbs.length;
      return suburbs[idx];
    }
  }
  // Unknown location — append ordinal variation so query differs each page
  const suffixes = ['', ' central', ' north', ' south', ' east'];
  return location + (suffixes[(page - 1) % suffixes.length] || '');
}

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

async function upsertToSupabase(places) {
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
      res.on('end', () => {
        console.log('Supabase status:', res.statusCode, data);
        resolve(res.statusCode);
      });
    });

    req.on('error', (e) => {
      console.error('Supabase error:', e.message);
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, location, radius = '20000', page = '1' } = req.query;
  if (!query || !location) return res.status(400).json({ error: 'Missing query or location' });

  const pageNum = Math.max(1, parseInt(page) || 1);
  const locVariant = getLocationVariant(location, pageNum);
  const searchQuery = `${query} ${locVariant} New Zealand`;

  try {
    const searchData = await fetchUrl(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${GOOGLE_KEY}`
    );

    if (!searchData.results?.length) {
      return res.status(200).json({ results: [], page: pageNum, hasMore: pageNum < 5, googleStatus: searchData.status });
    }

    const places = searchData.results.slice(0, 20);

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

    // Upsert to Supabase
    await upsertToSupabase(detailed.map(b => ({
      place_id: b.place_id,
      name: b.name,
      phone: b.phone || null,
      email: b.email || null,
      website: b.website || null,
      has_website: b.hasWebsite,
      rating: b.rating || null,
      address: b.address || null,
      industry: query,
      location_searched: locVariant
    })));

    return res.status(200).json({
      results: detailed,
      page: pageNum,
      hasMore: pageNum < 5,
      locationUsed: locVariant
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
