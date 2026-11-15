// Fausse boîte d'envoi : reçoit ce que la base enverrait au service d'e-mails.
const http = require('http'); const recus = [];
http.createServer((req, res) => {
  if (req.method === 'POST') { let c = ''; req.on('data', (d) => { c += d; }); req.on('end', () => { try { recus.push({ cle: req.headers['api-key'], ...JSON.parse(c) }); } catch { recus.push({ brut: c }); } res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"messageId":"test"}'); }); return; }
  if (req.url === '/vider') recus.length = 0;
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(recus));
}).listen(8777, '0.0.0.0');
