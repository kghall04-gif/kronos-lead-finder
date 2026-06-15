const https = require('https');
const http  = require('http');

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const BLOCKLIST = [
  'noreply','no-reply','donotreply','example','test@','@test',
  'sentry','wix','wordpress','squarespace','weebly','shopify',
  '@2x','@3x','.png','.jpg','.gif','.svg','.webp','schema',
  '@google','@facebook','@apple','@microsoft','@adobe',
  'privacy@','abuse@','postmaster@','legal@','spam@',
  'yourname','youremail','email@domain','name@'
];

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
      timeout: 5000
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        return fetchHtml(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 300000) res.destroy(); });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

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

  const { website, name, location } = req.query;
  const emails = new Set();
  const sources = [];
  let foundDomain = null;

  // STEP 1: Scrape website if provided
  if (website) {
    try {
      const base = new URL(website.startsWith('http') ? website : 'https://' + website);
      foundDomain = base.hostname.replace(/^www\./, '');
      const origin = `${base.protocol}//${base.hostname}`;
      for (const path of ['', '/contact', '/about', '/contact-us']) {
        try {
          const html = await fetchHtml(origin + path);
          extractEmails(html).forEach(e => emails.add(e));
        } catch(e) {}
      }
      if (emails.size > 0) sources.push('website');
    } catch(e) {}
  }

  // STEP 2: Yellow Pages NZ
  if (name) {
    try {
      const ypUrl = `https://www.yellowpages.co.nz/search?q=${encodeURIComponent(name)}&l=New+Zealand`;
      const html = await fetchHtml(ypUrl);
      const found = extractEmails(html);
      found.forEach(e => emails.add(e));
      if (found.length > 0) sources.push('yellowpages');

      // Also find any linked business website in YP and scrape it
      if (!foundDomain) {
        const siteMatch = html.match(/href="(https?:\/\/(?!(?:www\.)?yellowpages)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}[^"]*?)"/);
        if (siteMatch) {
          try {
            const siteHtml = await fetchHtml(siteMatch[1]);
            const siteEmails = extractEmails(siteHtml);
            siteEmails.forEach(e => emails.add(e));
            if (siteEmails.length > 0) sources.push('yellowpages-linked');
            foundDomain = new URL(siteMatch[1]).hostname.replace(/^www\./, '');
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  // STEP 3: Common patterns if domain known but no email found yet
  if (foundDomain && emails.size === 0) {
    ['info','contact','admin','hello','enquiries'].forEach(prefix => {
      emails.add(`${prefix}@${foundDomain}`);
    });
    sources.push('guessed');
  }

  // STEP 4: Final dedup + global blocklist
  const result = [...emails].filter(e =>
    !['@google','@facebook','@apple','@microsoft','@adobe','@sentry','@wix']
      .some(b => e.toLowerCase().includes(b))
  ).slice(0, 8);

  return res.status(200).json({ emails: result, sources: [...new Set(sources)] });
};
