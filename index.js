const http = require('http');
const url = require('url');
const mineflayer = require('mineflayer');

let activeBot = null; // Hozirgi faol botni saqlab turadi
const SECRET_KEY = '778899'; // Buni o'zingiz xohlagan maxfiy parolga o'zgartiring!

const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // Maxfiy havola orqali buyruq yuborish: /cmd?key=778899&text=/spawn
  if (parsedUrl.pathname === '/cmd') {
    const { key, text } = parsedUrl.query;

    if (key !== SECRET_KEY) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Noto‘g‘ri parol!');
    }

    if (!text) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Buyruq (text) yozilmadi!');
    }

    if (!activeBot || !activeBot.entity) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bot hozir serverda emas.');
    }

    activeBot.chat(text);
    console.log(`[REMOTE CMD] Yuborildi: ${text}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`Yuborildi: ${text}`);
  }

  // UptimeRobot uchun oddiy javob
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('uzcraft AFK bot is running\n');
}).listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});
