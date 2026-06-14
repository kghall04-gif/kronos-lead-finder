const https = require('https');

const SUPA_URL = process.env.SUPABASE_URL || 'https://knukfjvuwqckmnsyxozt.supabase.co';
const SUPA_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudWtmanZ1d3Fja21uc3l4b3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0Mjc3NjAsImV4cCI6MjA5NzAwMzc2MH0.j_OgX2LB4kPkjl9P_JRBX0EGxepAC9ua64ksPvJdG8o';

function getCount(path) {
  return new Promise((resolve) => {
    const u = new URL(SUPA_URL);
    const req = https.request({
      hostname: u.hostname,
      path: path,
      method: 'GET',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Accept': 'application/json',
        'Range': '0-0',
        'Prefer': 'count=exact'
      }
    }, (res) => {
      // Count is in Content-Range header: "0-0/TOTAL"
      const range = res.headers['content-range'] || '0-0/0';
      const match = range.match(/\/(\d+)/);
      resolve(match ? parseInt(match[1]) : 0);
      res.resume();
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [total, noWebsite, addedToday] = await Promise.all([
      getCount('/rest/v1/leads?select=place_id'),
      getCount('/rest/v1/leads?select=place_id&has_website=eq.false'),
      getCount(`/rest/v1/leads?select=place_id&created_at=gte.${today}T00:00:00`)
    ]);
    return res.status(200).json({ total, noWebsite, addedToday });
  } catch(e) {
    return res.status(200).json({ total: 0, noWebsite: 0, addedToday: 0, error: e.message });
  }
};
