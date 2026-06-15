const https = require('https');

const SUPA_URL   = process.env.SUPABASE_URL;
const SUPA_KEY   = process.env.SUPABASE_KEY;
const WEBHOOK    = process.env.APPS_SCRIPT_WEBHOOK;

function postJson(hostname, path, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, industry, phone, email, colour, website, address, rating, place_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const supaRow = {
    place_id: place_id || `manual_${Date.now()}`,
    name, industry: industry || '',
    phone: phone || '',
    email: email || '',
    colour: colour || '#FF3B3B',
    website: website || '',
    has_website: !!website,
    address: address || '',
    rating: parseFloat(rating) || 0,
    added: true
  };

  const sheetRow = {
    name, industry: industry || '',
    phone: phone || '',
    email: email || '',
    colour: colour || '#FF3B3B',
    website: website || '',
    date: new Date().toLocaleDateString('en-NZ')
  };

  // Supabase upsert
  try {
    const u = new URL(SUPA_URL);
    await postJson(u.hostname, '/rest/v1/leads', {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    }, supaRow);
  } catch(e) { /* log only */ }

  // Google Apps Script webhook — follow redirect to script.googleusercontent.com
  try {
    const wUrl = new URL(WEBHOOK);
    await postJson(wUrl.hostname, wUrl.pathname, {}, sheetRow);
  } catch(e) { /* non-fatal */ }

  return res.status(200).json({ success: true });
};
