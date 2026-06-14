const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    isOpen: null
  };
}

async function fetchDetails(place, key) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,rating,opening_hours,formatted_address,user_ratings_total&key=${key}`;
    const data = await fetchUrl(url);
    if (!data.result) return basicResult(place);
    const d = data.result;
    return {
      place_id: place.place_id,
      name: d.name || place.name,
      phone: d.formatted_phone_number || '',
      website: d.website || '',
      hasWebsite: !!d.website,
      rating: d.rating || place.rating || 0,
      reviewCount: d.user_ratings_total || 0,
      address: d.formatted_address || place.formatted_address || '',
      isOpen: d.opening_hours?.open_now ?? null
    };
  } catch(e) { return basicResult(place); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, location, pagetoken } = req.query;
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return res.status(500).json({ error: 'Missing API key' });

  try {
    let searchData;

    if (pagetoken) {
      // Continuation page — Google requires 2s before token is valid
      await sleep(2000);
      searchData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${encodeURIComponent(pagetoken)}&key=${key}`
      );
    } else {
      if (!query || !location) return res.status(400).json({ error: 'Missing query or location' });

      const geoData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location + ' New Zealand')}&key=${key}`
      );
      if (!geoData.results?.length) return res.status(404).json({ error: 'Location not found' });
      const { lat, lng } = geoData.results[0].geometry.location;

      searchData = await fetchUrl(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + location + ' New Zealand')}&location=${lat},${lng}&radius=20000&key=${key}`
      );
    }

    if (!searchData.results?.length) return res.status(200).json({ results: [], nextPageToken: null });

    const places = searchData.results.slice(0, 20);
    const detailed = [];

    for (let i = 0; i < places.length; i += 10) {
      const batch = places.slice(i, i + 10);
      const results = await Promise.all(batch.map(p => fetchDetails(p, key)));
      detailed.push(...results);
    }

    return res.status(200).json({
      results: detailed,
      nextPageToken: searchData.next_page_token || null
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
