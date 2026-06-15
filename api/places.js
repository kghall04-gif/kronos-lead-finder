const https = require('https');

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
const SUPA_URL   = process.env.SUPABASE_URL;
const SUPA_KEY   = process.env.SUPABASE_KEY;
const CO_KEY     = process.env.COMPANIES_OFFICE_KEY || '';
const YELP_KEY   = process.env.YELP_API_KEY || '';

// Complete NZ suburb coverage — used to vary search queries across pages
const NZ_LOCATIONS = {
  // AUCKLAND REGION
  'auckland': [
    'Auckland CBD', 'Ponsonby', 'Newmarket', 'Parnell', 'Remuera',
    'Mt Eden', 'Epsom', 'Onehunga', 'Otahuhu', 'Manukau',
    'Papatoetoe', 'Botany', 'Howick', 'Pakuranga', 'Flat Bush',
    'Henderson', 'New Lynn', 'Avondale', 'Waitakere', 'Massey',
    'Albany', 'Takapuna', 'Devonport', 'Birkenhead', 'Glenfield',
    'Browns Bay', 'Orewa', 'Silverdale', 'Kumeu', 'Helensville',
    'Pukekohe', 'Papakura', 'Beachlands', 'Clevedon', 'Warkworth',
    'Wellsford', 'Snells Beach', 'Whangaparaoa', 'Stanmore Bay', 'Milford'
  ],
  // HAMILTON / WAIKATO
  'hamilton': [
    'Hamilton CBD', 'Hamilton East', 'Hamilton West', 'Frankton',
    'Te Rapa', 'Nawton', 'Dinsdale', 'Rototuna', 'Flagstaff',
    'Hillcrest', 'Claudelands', 'Chartwell', 'Peacocke', 'Ruakura',
    'Silverdale', 'Huntington', 'Temple View', 'Enderley', 'Melville'
  ],
  'waikato': [
    'Hamilton', 'Cambridge', 'Te Awamutu', 'Huntly', 'Ngaruawahia',
    'Raglan', 'Morrinsville', 'Matamata', 'Putaruru', 'Tokoroa',
    'Te Kuiti', 'Otorohanga', 'Taupo', 'Turangi', 'Mangakino'
  ],
  // BAY OF PLENTY
  'tauranga': [
    'Tauranga CBD', 'Mount Maunganui', 'Papamoa', 'Greerton',
    'Bethlehem', 'Pyes Pa', 'Welcome Bay', 'Matua', 'Otumoetai',
    'Hairini', 'Gate Pa', 'Brookfield', 'Judea', 'Parkvale'
  ],
  'bay of plenty': [
    'Tauranga', 'Rotorua', 'Whakatane', 'Te Puke', 'Katikati',
    'Opotiki', 'Kawerau', 'Murupara', 'Maketu', 'Edgecumbe'
  ],
  'rotorua': [
    'Rotorua CBD', 'Ngongotaha', 'Holdens Bay', 'Fairy Springs',
    'Western Heights', 'Glenholme', 'Fenton Park', 'Koutu', 'Fordlands'
  ],
  // WELLINGTON REGION
  'wellington': [
    'Wellington CBD', 'Thorndon', 'Newtown', 'Kilbirnie',
    'Miramar', 'Karori', 'Johnsonville', 'Tawa', 'Churton Park',
    'Island Bay', 'Brooklyn', 'Aro Valley', 'Te Aro', 'Mt Victoria',
    'Hataitai', 'Lyall Bay', 'Seatoun', 'Roseneath', 'Oriental Bay'
  ],
  'lower hutt': [
    'Lower Hutt CBD', 'Petone', 'Eastbourne', 'Wainuiomata',
    'Stokes Valley', 'Naenae', 'Taita', 'Avalon', 'Waterloo', 'Moera'
  ],
  'upper hutt': [
    'Upper Hutt CBD', 'Silverstream', 'Heretaunga', 'Trentham',
    'Maoribank', 'Birchville', 'Totara Park', 'Pinehaven'
  ],
  'porirua': [
    'Porirua CBD', 'Titahi Bay', 'Ranui', 'Cannons Creek',
    'Waitangirua', 'Ascot Park', 'Plimmerton', 'Paremata'
  ],
  // CHRISTCHURCH / CANTERBURY
  'christchurch': [
    'Christchurch CBD', 'Riccarton', 'Hornby', 'Sockburn',
    'Papanui', 'Merivale', 'St Albans', 'Sydenham', 'Addington',
    'Ferrymead', 'Sumner', 'New Brighton', 'Burnside', 'Bishopdale',
    'Belfast', 'Rolleston', 'Lincoln', 'Rangiora', 'Kaiapoi',
    'Halswell', 'Wigram', 'Spreydon', 'Cashmere', 'Woolston'
  ],
  'canterbury': [
    'Christchurch', 'Rangiora', 'Kaiapoi', 'Rolleston', 'Lincoln',
    'Ashburton', 'Timaru', 'Temuka', 'Geraldine', 'Darfield',
    'Oxford', 'Leeston', 'Prebbleton', 'Halswell', 'Waimakariri'
  ],
  // DUNEDIN / OTAGO
  'dunedin': [
    'Dunedin CBD', 'South Dunedin', 'Mosgiel', 'Green Island',
    'Caversham', 'St Kilda', 'St Clair', 'Andersons Bay', 'Maori Hill',
    'Roslyn', 'Mornington', 'Corstorphine', 'Burnside', 'Brockville',
    'Abbotsford', 'Concord', 'Fairfield', 'Waldronville', 'Brighton'
  ],
  'otago': [
    'Dunedin', 'Queenstown', 'Wanaka', 'Alexandra', 'Cromwell',
    'Oamaru', 'Balclutha', 'Milton', 'Lawrence', 'Roxburgh',
    'Ranfurly', 'Palmerston', 'Mosgiel', 'Portobello'
  ],
  'queenstown': [
    'Queenstown CBD', 'Frankton', 'Arrowtown', 'Kelvin Heights',
    'Arthurs Point', 'Lake Hayes', 'Jacks Point', 'Hanley Farm',
    'Wanaka', 'Albert Town', 'Hawea', 'Luggate'
  ],
  // HAWKES BAY
  'napier': [
    'Napier CBD', 'Taradale', 'Marewa', 'Onekawa', 'Maraenui',
    'Pirimai', 'Greenmeadows', 'Bay View', 'Clive', 'Eskdale'
  ],
  'hastings': [
    'Hastings CBD', 'Havelock North', 'Flaxmere', 'Whakatu',
    'Clive', 'Bridge Pa', 'Puketapu', 'Haumoana', 'Te Awanga'
  ],
  'hawkes bay': [
    'Napier', 'Hastings', 'Havelock North', 'Waipukurau',
    'Wairoa', 'Dannevirke', 'Waipawa', 'Otane', 'Takapau'
  ],
  // PALMERSTON NORTH / MANAWATU
  'palmerston north': [
    'Palmerston North CBD', 'Roslyn', 'Milson', 'Awapuni',
    'Kelvin Grove', 'Highbury', 'Cloverlea', 'Takaro', 'Terrace End',
    'Hokowhitu', 'Aokautere', 'Fitzherbert', 'Ashhurst', 'Fielding'
  ],
  'manawatu': [
    'Palmerston North', 'Feilding', 'Levin', 'Foxton', 'Shannon',
    'Bulls', 'Marton', 'Sanson', 'Ashhurst', 'Woodville'
  ],
  // NELSON / MARLBOROUGH
  'nelson': [
    'Nelson CBD', 'Stoke', 'Richmond', 'Wakefield', 'Brightwater',
    'Hope', 'Motueka', 'Mapua', 'Moutere', 'Takaka', 'Golden Bay'
  ],
  'marlborough': [
    'Blenheim', 'Picton', 'Havelock', 'Renwick', 'Seddon',
    'Ward', 'Kaikoura', 'Rai Valley', 'Canvastown'
  ],
  // NORTHLAND
  'whangarei': [
    'Whangarei CBD', 'Kamo', 'Maunu', 'Tikipunga', 'Otangarei',
    'Raumanga', 'Morningside', 'Regent', 'Port Marsden', 'Ruakaka'
  ],
  'northland': [
    'Whangarei', 'Kerikeri', 'Kaitaia', 'Dargaville', 'Paihia',
    'Russell', 'Mangawhai', 'Waipu', 'Maungaturoto', 'Kaiwaka',
    'Rawene', 'Hokianga', 'Kawakawa', 'Okaihau', 'Kaikohe'
  ],
  // TARANAKI
  'new plymouth': [
    'New Plymouth CBD', 'Strandon', 'Fitzroy', 'Merrilands',
    'Vogeltown', 'Inglewood', 'Bell Block', 'Waitara', 'Oakura',
    'Oakura Beach', 'Omata', 'Westown', 'Moturoa', 'Spotswood'
  ],
  'taranaki': [
    'New Plymouth', 'Hawera', 'Stratford', 'Inglewood', 'Waitara',
    'Opunake', 'Patea', 'Eltham', 'Okato', 'Urenui'
  ],
  // GISBORNE
  'gisborne': [
    'Gisborne CBD', 'Elgin', 'Kaiti', 'Whataupoko', 'Mangapapa',
    'Manutuke', 'Patutahi', 'Ormond', 'Wainui Beach', 'Tolaga Bay'
  ],
  // SOUTHLAND
  'invercargill': [
    'Invercargill CBD', 'Bluff', 'Waikiwi', 'Hawthorndale',
    'Strathern', 'Grasmere', 'Georgetown', 'Windsor', 'Otatara'
  ],
  'southland': [
    'Invercargill', 'Gore', 'Winton', 'Lumsden', 'Riverton',
    'Tuatapere', 'Te Anau', 'Milford Sound', 'Wyndham', 'Balclutha'
  ],
  // WEST COAST
  'west coast': [
    'Greymouth', 'Hokitika', 'Westport', 'Reefton', 'Karamea',
    'Franz Josef', 'Fox Glacier', 'Haast', 'Ross', 'Runanga'
  ],
  // WHANGANUI
  'whanganui': [
    'Whanganui CBD', 'Castlecliff', 'Gonville', 'Aramoho',
    'St Johns Hill', 'Springvale', 'Mosston', 'Brunswick', 'Fordell'
  ],
  // KAPITI COAST
  'kapiti': [
    'Paraparaumu', 'Waikanae', 'Otaki', 'Raumati', 'Paekakariki',
    'Levin', 'Foxton', 'Shannon', 'Te Horo', 'Peka Peka'
  ],
  // TIMARU
  'timaru': [
    'Timaru CBD', 'Washdyke', 'Gleniti', 'Parkside', 'Highfield',
    'Pleasant Point', 'Temuka', 'Geraldine', 'Orari'
  ]
};

function getSuburbs(location) {
  const l = location.toLowerCase().trim();
  if (NZ_LOCATIONS[l]) return NZ_LOCATIONS[l];
  for (const key of Object.keys(NZ_LOCATIONS)) {
    if (l.includes(key) || key.includes(l)) return NZ_LOCATIONS[key];
  }
  return [
    location + ' CBD', location + ' North', location + ' South',
    location + ' East', location + ' West', 'Central ' + location
  ];
}

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

  const page     = parseInt(req.query.page) || 1;
  const query    = req.query.query || req.query.q || '';
  const location = req.query.location || '';

  if (!query || !location) return res.status(400).json({ error: 'Missing query or location' });

  try {
    let placesResults = [];
    let suburbsSearched = [];

    if (page === 1) {
      // Page 1 — geocode then straight text search
      let locationParam = '';
      try {
        const geoData = await fetchUrl(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location + ' New Zealand')}&key=${GOOGLE_KEY}`
        );
        if (geoData.results?.length) {
          const { lat, lng } = geoData.results[0].geometry.location;
          locationParam = `&location=${lat},${lng}&radius=20000`;
        }
      } catch(e) {}

      const searchData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + location + ' New Zealand')}${locationParam}&key=${GOOGLE_KEY}`
      );
      placesResults  = searchData.results || [];
      suburbsSearched = [location];

    } else {
      // Page 2+ — suburb rotation: 3 suburbs per page
      const suburbs  = getSuburbs(location);
      const startIdx = (page - 2) * 3;
      const selected = suburbs.slice(startIdx, startIdx + 3);

      if (selected.length === 0) {
        const totalPages = Math.ceil(suburbs.length / 3) + 1;
        return res.status(200).json({ results: [], page, totalPages, suburbsSearched: [] });
      }

      suburbsSearched = selected;

      const searches = await Promise.all(
        selected.map(suburb =>
          fetchUrl(
            `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + suburb + ' New Zealand')}&key=${GOOGLE_KEY}`
          ).catch(() => ({ results: [] }))
        )
      );

      const seen = new Set();
      for (const result of searches) {
        for (const place of (result.results || [])) {
          if (!seen.has(place.place_id)) {
            seen.add(place.place_id);
            placesResults.push(place);
          }
        }
      }
    }

    if (!placesResults.length) {
      const suburbs    = getSuburbs(location);
      const totalPages = Math.ceil(suburbs.length / 3) + 1;
      return res.status(200).json({ results: [], page, totalPages, suburbsSearched });
    }

    // Fetch details in batches of 5 (max 20)
    const top20    = placesResults.slice(0, 20);
    const detailed = [];
    for (let i = 0; i < top20.length; i += 5) {
      const batch = top20.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(place =>
          fetchUrl(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,rating,opening_hours,formatted_address,user_ratings_total&key=${GOOGLE_KEY}`
          ).then(d => ({
            place_id:    place.place_id,
            name:        d.result?.name || place.name,
            phone:       d.result?.formatted_phone_number || '',
            website:     d.result?.website || '',
            hasWebsite:  !!d.result?.website,
            rating:      d.result?.rating || 0,
            reviewCount: d.result?.user_ratings_total || 0,
            address:     d.result?.formatted_address || '',
            isOpen:      d.result?.opening_hours?.open_now ?? null,
            director:    '',
            source:      'google'
          })).catch(() => null)
        )
      );
      detailed.push(...batchResults.filter(Boolean));
    }

    // Merge Yelp on page 1 only
    let merged = detailed;
    if (page === 1) {
      const yelpResults = await fetchYelp(query, location);
      merged = mergeResults(detailed, yelpResults);
    }

    // Companies Office on page 1 only
    if (CO_KEY && page === 1) {
      const directors = await Promise.all(merged.map(b => getDirector(b.name)));
      directors.forEach((d, i) => { merged[i].director = d; });
    }

    await upsertToSupabase(merged.map(b => ({
      place_id:          b.place_id,
      name:              b.name,
      phone:             b.phone || null,
      email:             null,
      website:           b.website || null,
      has_website:       b.hasWebsite,
      rating:            b.rating || null,
      address:           b.address || null,
      industry:          query,
      location_searched: location
    })));

    const suburbs    = getSuburbs(location);
    const totalPages = Math.ceil(suburbs.length / 3) + 1;

    return res.status(200).json({ results: merged, page, totalPages, suburbsSearched });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
