const https = require('https');
const http  = require('http');

function fetchHtml(urlStr, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(urlStr); } catch(e) { return reject(new Error('Bad URL')); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: parsed.hostname,
      path: (parsed.pathname || '/') + (parsed.search || ''),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KronosBot/2.0)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 7000
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return fetchHtml(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 500000) res.destroy(); });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/g;
const BLOCKLIST = [
  'noreply','no-reply','donotreply','example.com','test@','@test',
  'sentry','wix','wordpress','squarespace','weebly','shopify',
  '@2x','@3x','.png','.jpg','.gif','.svg','.webp',
  'privacy@','abuse@','postmaster@','legal@','spam@','support@wix',
  'yourname','youremail','email@domain','name@'
];

function extractEmails(html) {
  const decoded = html
    .replace(/&#64;/g,'@').replace(/\[at\]/gi,'@').replace(/\(at\)/gi,'@')
    .replace(/\\u0040/g,'@').replace(/%40/g,'@');
  const raw = decoded.match(EMAIL_RE) || [];
  return [...new Set(raw)].filter(e =>
    e.length < 80 &&
    e.includes('.') &&
    !BLOCKLIST.some(b => e.toLowerCase().includes(b))
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { website } = req.query;
  if (!website) return res.status(400).json({ error: 'Missing website', emails: [] });

  let base;
  try { base = new URL(website.startsWith('http') ? website : 'https://' + website); }
  catch(e) { return res.status(400).json({ error: 'Invalid URL', emails: [] }); }

  const origin = `${base.protocol}//${base.hostname}`;
  const emails = new Set();

  try {
    const html = await fetchHtml(origin);
    extractEmails(html).forEach(e => emails.add(e));
  } catch(e) {}

  if (emails.size === 0) {
    for (const path of ['/contact', '/contact-us', '/about', '/about-us', '/get-in-touch', '/reach-us']) {
      try {
        const html = await fetchHtml(origin + path);
        extractEmails(html).forEach(e => emails.add(e));
        if (emails.size > 0) break;
      } catch(e) {}
    }
  }

  return res.status(200).json({ emails: [...emails].slice(0, 6) });
};
