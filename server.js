const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
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

  const FB_CONFIG = JSON.stringify({
    apiKey: "AIzaSyDDqB8GUVKd5eCBErI2BXMJLU1ls_RwDak",
    authDomain: "chatin-f3419.firebaseapp.com",
    projectId: "chatin-f3419",
    storageBucket: "chatin-f3419.firebasestorage.app",
    messagingSenderId: "609174716770",
    appId: "1:609174716770:web:485e94df404dce84f004b3"
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
