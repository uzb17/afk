const http = require('http');
const mineflayer = require('mineflayer');

// Render uxlab qolmasligi uchun mini HTTP server
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('uzcraft AFK bot is running\n');
}).listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

let antiAfkInterval = null;
let dropItemsInterval = null;
let reconnectTimeout = null;
let isReconnecting = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min = 200, max = 500) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function cleanupTimers() {
  if (antiAfkInterval) {
    clearInterval(antiAfkInterval);
    antiAfkInterval = null;
  }
  if (dropItemsInterval) {
    clearInterval(dropItemsInterval);
    dropItemsInterval = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

function scheduleReconnect(reason) {
  if (isReconnecting) return;
  isReconnecting = true;
  cleanupTimers();
  console.log(`[RECONNECT] ${reason}. 15 soniyadan keyin qayta ulanadi...`);
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    startBot();
  }, 15000);
}

// Har 3 daqiqada inventardagi narsalarni 200-500 ms random oraliq bilan tashlash
async function dropAllItems(bot) {
  if (!bot.inventory) return;
  const items = bot.inventory.items();
  if (items.length === 0) return;

  console.log(`[INVENTORY] ${items.length} ta slotdagi narsalar tashlanmoqda...`);
  for (const item of items) {
    try {
      await bot.tossStack(item);
      await sleep(randomDelay(200, 500));
    } catch (err) {
      console.log('[DROP ERROR]', err.message);
    }
  }
}

function startBot() {
  cleanupTimers();

  const bot = mineflayer.createBot({
    host: 'frokamc.uz',
    port: 25565,
    username: 'uzcraft',
    version: '1.21.11'
  });

  let loginSent = false;

  function runLoginAndCommands() {
    if (loginSent) return;
    loginSent = true;

    console.log('[CMD] /login 123456 yuborilmoqda...');
    bot.chat('/login 123456');

    setTimeout(() => {
      console.log('[CMD] /server anarxiya2 yuborilmoqda...');
      bot.chat('/server anarxiya2');
    }, 6000);

    setTimeout(() => {
      console.log('[CMD] /pay casxuz 1m yuborilmoqda...');
      bot.chat('/pay casxuz 1m');
    }, 14000);

    setTimeout(() => {
      console.log('[CMD] /tpa casxuz yuborilmoqda...');
      bot.chat('/tpa casxuz');
    }, 19000);
  }

  bot.once('spawn', () => {
    console.log('[BOT] Serverga ulanildi (spawn).');

    // Zaxira taymer: 6 soniyadan keyin ham login ketmagan bo'lsa, yuboradi
    setTimeout(() => {
      runLoginAndCommands();
    }, 6000);

    // Anti-AFK: har 45 soniyada qarashni o'zgartirish va 200-500 ms random sakrash
    antiAfkInterval = setInterval(() => {
      if (!bot.entity) return;
      const yaw = bot.entity.yaw + (Math.random() * 0.4 - 0.2);
      const pitch = Math.max(-0.5, Math.min(0.5, bot.entity.pitch + (Math.random() * 0.2 - 0.1)));
      bot.look(yaw, pitch, false).catch(() => {});
      bot.setControlState('jump', true);
      setTimeout(() => {
        bot.setControlState('jump', false);
      }, randomDelay(200, 500));
    }, 45000);

    // Har 3 daqiqada inventardagi barcha narsalarni tashlash
    dropItemsInterval = setInterval(() => {
      dropAllItems(bot);
    }, 3 * 60 * 1000);
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    if (!text) return;
    console.log('[CHAT]', text);

    const lower = text.toLowerCase();
    if (!loginSent && (lower.includes('/login') || lower.includes('/ʟᴏɢɪɴ'))) {
      setTimeout(() => {
        runLoginAndCommands();
      }, 3000);
    }
  });

  bot.on('kicked', (reason) => {
    console.log('[KICKED]', reason);
    scheduleReconnect('Kick qilindi');
  });

  bot.on('end', (reason) => {
    console.log('[END]', reason || 'Ulanish yopildi');
    scheduleReconnect('Sessiya tugadi');
  });

  bot.on('error', (err) => {
    console.log('[ERROR]', err.message);
    scheduleReconnect('Xatolik yuz berdi');
  });
}

startBot();
