const https = require('https');
const http = require('http');

function fetchHtml(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(urlStr); } catch(e) { return reject(e); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadFinder/1.0)',
        'Accept': 'text/html'
      },
      timeout: 6000
    };

    const req = lib.get(opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        return fetchHtml(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 300000) res.destroy(); });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractEmails(html) {
  // Decode common HTML entities first
  const decoded = html.replace(/&#64;/g, '@').replace(/\[at\]/gi, '@').replace(/\(at\)/gi, '@');
  const regex = /[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/g;
  const raw = decoded.match(regex) || [];
  const blocklist = ['example.com','sentry.io','wixpress.com','squarespace.com',
    'wordpress.com','schema.org','w3.org','yoursite','youremail','info@info',
    'email@email','test@test','user@user','noreply','no-reply'];
  return [...new Set(raw)].filter(e =>
    !blocklist.some(b => e.includes(b)) &&
    !e.match(/\.(png|jpg|gif|svg|css|js|woff)$/i) &&
    e.length < 80
  ).slice(0, 8);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { website } = req.query;
  if (!website) return res.status(400).json({ error: 'Missing website param', emails: [] });

  const emails = new Set();

  // Normalise URL
  let base = website.startsWith('http') ? website : `https://${website}`;
  // Remove trailing slash
  base = base.replace(/\/$/, '');

  // Try homepage
  try {
    const html = await fetchHtml(base);
    extractEmails(html).forEach(e => emails.add(e));
  } catch(e) {}

  // Try /contact if still empty
  if (emails.size === 0) {
    for (const path of ['/contact', '/contact-us', '/about', '/about-us']) {
      try {
        const html = await fetchHtml(base + path);
        extractEmails(html).forEach(e => emails.add(e));
        if (emails.size > 0) break;
      } catch(e) {}
    }
  }

  return res.status(200).json({ emails: [...emails] });
};
