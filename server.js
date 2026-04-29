const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const HOST = '0.0.0.0'; // Bind to all interfaces (IPv4)

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // --- SHOPIER CALLBACK (ÖDEME BİLDİRİMİ) ---
  if (req.url === '/shopier-callback' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      // Not: Burası Shopier panelindeki Geri Bildirim URL'sine bağlandığında otomatik tetiklenir.
      console.log("Shopier Bildirimi Geldi, İşleniyor...");
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }

  // --- ÖDEME SİSTEMİ (SIMULASYON) ---
  if (req.url === '/create-checkout-session' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const { userId } = JSON.parse(body);
      const mockSessionUrl = `http://localhost:3001/payment-success?userId=${userId}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: mockSessionUrl }));
    });
    return;
  }

  if (req.url.startsWith('/payment-success')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <div style="background:#05060f; color:#c5a059; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif;">
            <h1 style="font-size:48px;">🚀 ÖDEME BAŞARILI!</h1>
            <p style="color:#fff;">Galaktik Premium üyeliğiniz onaylandı. Yönlendiriliyorsunuz...</p>
            <script>
                setTimeout(() => { window.location.href = "/"; }, 3000);
            </script>
        </div>
    `);
    return;
  }

  const FB_CONFIG = JSON.stringify({
    apiKey: "AIzaSyBJzU5PW0VgvHPRhcfDXZBWPFPV2Xak3W8",
    authDomain: "chatin-3c6a5.firebaseapp.com",
    projectId: "chatin-3c6a5",
    storageBucket: "chatin-3c6a5.firebasestorage.app",
    messagingSenderId: "130139862155",
    appId: "1:130139862155:web:8966aaeba6ad443041108e"
  });

  // Init.json Yolu
  if (req.url.endsWith('/__/firebase/init.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(FB_CONFIG);
    return;
  }

  // Init.js Yolu
  if (req.url.endsWith('/__/firebase/init.js')) {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(`if (typeof firebase !== 'undefined') firebase.initializeApp(${FB_CONFIG});`);
    return;
  }

  let filePath = '.' + req.url;
  if (filePath === './') filePath = './index.html';

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  // COOP Header - Güvenlik için tutulmalı
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end(error.code === 'ENOENT' ? '404 Not Found' : `Server Error: ${error.code}`);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Sunucu çalışıyor:`);
  console.log(`- Local:   http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.1.86:${PORT}`);
});
