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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, location } = req.query;
  if (!query || !location) return res.status(400).json({ error: 'Missing query or location' });

  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return res.status(500).json({ error: 'Missing API key' });

  try {
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location + ' New Zealand')}&key=${key}`;
    const geoData = await fetchUrl(geoUrl);

    if (!geoData.results || geoData.results.length === 0) {
      return res.status(404).json({ error: 'Location not found', status: geoData.status });
    }

    const { lat, lng } = geoData.results[0].geometry.location;

    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + location + ' New Zealand')}&location=${lat},${lng}&radius=20000&key=${key}`;
    const searchData = await fetchUrl(searchUrl);

    if (!searchData.results || searchData.results.length === 0) {
      return res.status(200).json({ results: [] });
    }

    const places = searchData.results.slice(0, 15);
    const detailed = [];

    for (const place of places) {
      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,rating,opening_hours,formatted_address&key=${key}`;
        const detailData = await fetchUrl(detailUrl);
        if (detailData.result) {
          detailed.push({
            place_id: place.place_id,
            name: detailData.result.name,
            phone: detailData.result.formatted_phone_number || '',
            website: detailData.result.website || '',
            hasWebsite: !!detailData.result.website,
            rating: detailData.result.rating || 0,
            address: detailData.result.formatted_address || '',
            isOpen: detailData.result.opening_hours?.open_now
          });
        }
      } catch(e) {}
    }

    return res.status(200).json({ results: detailed });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
