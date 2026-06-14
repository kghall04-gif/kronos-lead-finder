const https = require('https');
const http = require('http');

function fetchHtml(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(urlStr); } catch(e) { return reject(new Error('Bad URL')); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-NZ,en;q=0.9'
      },
      timeout: 7000
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
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

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/g;

const BLOCKLIST = [
  'example.com','sentry.io','wixpress.com','squarespace.com','wordpress.com',
  'schema.org','w3.org','yoursite','youremail','info@info','email@email',
  'test@','user@user','noreply','no-reply','donotreply','support@wix',
  'privacy@','legal@','abuse@','postmaster@','webmaster@','spam@',
  '@2x.','@3x.','sentry-','rollbar','bugsnag','logrocket'
];

function extractEmails(html) {
  const decoded = html
    .replace(/&#64;/g, '@').replace(/\[at\]/gi, '@').replace(/\(at\)/gi, '@')
    .replace(/\\u0040/g, '@').replace(/%40/g, '@');
  const raw = decoded.match(EMAIL_REGEX) || [];
  return [...new Set(raw)].filter(e =>
    !BLOCKLIST.some(b => e.toLowerCase().includes(b)) &&
    !e.match(/\.(png|jpg|gif|svg|css|js|woff|ttf|eot|map)$/i) &&
    e.length < 80 &&
    e.includes('.')
  );
}

function findFacebookUrl(html) {
  const match = html.match(/https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9._\-/]+/);
  return match ? match[0].split('"')[0].split("'")[0] : null;
}

async function scrapeWebsite(url) {
  const emails = new Set();
  let base;
  try { base = new URL(url.startsWith('http') ? url : 'https://' + url); }
  catch(e) { return { emails: [], fbUrl: null }; }

  const baseStr = `${base.protocol}//${base.hostname}`;
  let fbUrl = null;

  // Scrape homepage
  try {
    const html = await fetchHtml(baseStr);
    extractEmails(html).forEach(e => emails.add(e));
    if (!fbUrl) fbUrl = findFacebookUrl(html);
  } catch(e) {}

  // If no emails, try contact / about pages
  if (emails.size === 0) {
    for (const path of ['/contact', '/contact-us', '/about', '/about-us', '/get-in-touch']) {
      try {
        const html = await fetchHtml(baseStr + path);
        extractEmails(html).forEach(e => emails.add(e));
        if (!fbUrl) fbUrl = findFacebookUrl(html);
        if (emails.size > 0) break;
      } catch(e) {}
    }
  }

  return { emails: [...emails], fbUrl };
}

async function scrapeFacebook(fbUrl) {
  // Facebook public pages show some content without login
  try {
    const html = await fetchHtml(fbUrl);
    return extractEmails(html);
  } catch(e) { return []; }
}

async function searchDirectory(url, label) {
  try {
    const html = await fetchHtml(url);
    const found = extractEmails(html);
    return found;
  } catch(e) { return []; }
}

async function searchNZDirectories(name, location) {
  const emails = new Set();
  const query = encodeURIComponent(name + (location ? ' ' + location : ''));
  const sources = [
    `https://www.finda.co.nz/search/?q=${query}`,
    `https://www.yellowpages.co.nz/search?q=${query}`,
    `https://www.localist.co.nz/search/?query=${query}`,
    `https://www.nzlocal.co.nz/?q=${query}`
  ];

  const results = await Promise.allSettled(sources.map(url => searchDirectory(url)));
  results.forEach(r => {
    if (r.status === 'fulfilled') r.value.forEach(e => emails.add(e));
  });

  return [...emails];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { website, name, location } = req.query;
  if (!website && !name) return res.status(400).json({ error: 'Missing website or name', emails: [] });

  const allEmails = new Set();
  const sources = {};

  // 1. Scrape business website + follow Facebook link
  if (website) {
    const { emails: webEmails, fbUrl } = await scrapeWebsite(website);
    webEmails.forEach(e => { allEmails.add(e); sources[e] = 'website'; });

    if (fbUrl && webEmails.length === 0) {
      const fbEmails = await scrapeFacebook(fbUrl);
      fbEmails.forEach(e => { allEmails.add(e); sources[e] = 'facebook'; });
    }
  }

  // 2. Search NZ directories if name given and still no emails
  if (name && allEmails.size === 0) {
    const dirEmails = await searchNZDirectories(name, location || '');
    dirEmails.forEach(e => { allEmails.add(e); sources[e] = 'directory'; });
  }

  const emails = [...allEmails].slice(0, 6);
  return res.status(200).json({
    emails,
    sources: emails.reduce((acc, e) => { acc[e] = sources[e] || 'web'; return acc; }, {})
  });
};
