// Serveur de test : sert le site tel quel, en ajoutant seulement la base locale
// à la politique de sécurité et en fournissant la configuration locale.
const http = require('http'), fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..');
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/index.html';
  const chemin = path.join(RACINE, path.normalize(f));
  if (!chemin.startsWith(RACINE) || !fs.existsSync(chemin)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(chemin); res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' });
  if (f === '/config.js') return res.end(`window.ZOE_CONFIG={url:'http://127.0.0.1:54321',cle:'${KEY}',codeParEmail:${!/lien=1/.test(req.headers.cookie || '')},site:'http://127.0.0.1:8766'};`);
  if (ext === '.html') return res.end(fs.readFileSync(chemin, 'utf8').replaceAll('https://*.supabase.co', 'https://*.supabase.co http://127.0.0.1:54321'));
  res.end(fs.readFileSync(chemin));
}).listen(8766, '127.0.0.1');
