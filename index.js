const http = require('http');
const mineflayer = require('mineflayer');

// ================= ENV SOZLAMALARI =================
const TG_TOKEN = process.env.TG_TOKEN || '';
const OWNER_ID = Number(process.env.OWNER_ID || 0);

const MC_HOST = process.env.MC_HOST || 'frokamc.uz';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_USER = process.env.MC_USER || 'uzcraft';
const MC_VERSION = process.env.MC_VERSION || '1.21.11';
const MC_PASS = process.env.MC_PASS || '123456';
// ===================================================

// Render uxlab qolmasligi uchun mini HTTP server
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`${MC_USER} AFK bot is running\n`);
}).listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

let activeBot = null;
let antiAfkInterval = null;
let dropItemsInterval = null;
let reconnectTimeout = null;
let isReconnecting = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min = 200, max = 500) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Telegramga xabar yuborish funksiyasi
async function sendTgMessage(chatId, text) {
  if (!TG_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text
      })
    });
  } catch (err) {
    console.log('[TG SEND ERROR]', err.message);
  }
}

// Egasiga (OWNER_ID) bildirishnoma yuborish
function notifyOwner(text) {
  if (!OWNER_ID) return;
  sendTgMessage(OWNER_ID, text);
}

// Telegramdan kelgan xabarlarni doimiy tekshirib turish (Long Polling)
async function startTelegramPolling() {
  if (!TG_TOKEN) {
    console.log('[TG] TG_TOKEN o‘rnatilmagan, Telegram bot o‘chiq.');
    return;
  }

  let offset = 0;
  console.log('[TG] Telegram bot tinglashni boshladi...');
  notifyOwner(`🤖 ${MC_USER} Telegram boshqaruv moduli ishga tushdi.`);

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${offset}&timeout=25`
      );
      const data = await res.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          const msg = update.message;
          if (!msg || !msg.text) continue;

          if (!OWNER_ID || msg.from.id !== OWNER_ID) {
            await sendTgMessage(msg.chat.id, '⛔ Sizda bu botni boshqarish huquqi yo‘q.');
            continue;
          }

          const text = msg.text.trim();

          if (text === '/start' || text === '/help') {
            await sendTgMessage(
              msg.chat.id,
              `✅ ${MC_USER} MC Bot ulangan!\n\n` +
              '• Istalgan buyruq yoki matn yozing (masalan: /bal, /pay casxuz 100k, /spawn) — o‘yinga yuboriladi.\n' +
              '• /status — bot holati\n' +
              '• /drop — inventarni hozir tozalash\n' +
              '• /reconnect — serverga qayta ulanish'
            );
            continue;
          }

          if (text === '/status') {
            if (activeBot && activeBot.entity) {
              const pos = activeBot.entity.position;
              const itemsCount = activeBot.inventory ? activeBot.inventory.items().length : 0;
              await sendTgMessage(
                msg.chat.id,
                `🟢 Bot serverda (Online)\n` +
                `📍 Koordinata: X:${Math.round(pos.x)} Y:${Math.round(pos.y)} Z:${Math.round(pos.z)}\n` +
                `🎒 Inventar slotlari: ${itemsCount}`
              );
            } else {
              await sendTgMessage(msg.chat.id, '🔴 Bot hozir serverda emas yoki ulanmoqda.');
            }
            continue;
          }

          if (text === '/drop') {
            if (activeBot && activeBot.entity) {
              await sendTgMessage(msg.chat.id, '🗑 Inventar tozalanmoqda...');
              dropAllItems(activeBot);
            } else {
              await sendTgMessage(msg.chat.id, '🔴 Bot serverda emas.');
            }
            continue;
          }

          if (text === '/reconnect') {
            await sendTgMessage(msg.chat.id, '🔄 Qayta ulanilmoqda...');
            if (activeBot) activeBot.quit();
            scheduleReconnect('Telegram orqali qayta ulash');
            continue;
          }

          if (activeBot && activeBot.entity) {
            activeBot.chat(text);
            console.log(`[TG -> MC] ${text}`);
            await sendTgMessage(msg.chat.id, `📤 O‘yinga yuborildi: ${text}`);
          } else {
            await sendTgMessage(msg.chat.id, '🔴 Bot hozir serverda emas, biroz kuting.');
          }
        }
      }
    } catch (err) {
      console.log('[TG POLL ERROR]', err.message);
      await sleep(5000);
    }
  }
}

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
  notifyOwner(`⚠️ ${reason}. 15 soniyadan keyin qayta ulanadi...`);
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
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USER,
    version: MC_VERSION
  });

  activeBot = bot;
  let loginSent = false;

  function runLoginAndCommands() {
    if (loginSent) return;
    loginSent = true;

    console.log('[CMD] /login yuborilmoqda...');
    bot.chat(`/login ${MC_PASS}`);

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
    notifyOwner(`🟢 ${MC_USER} ${MC_HOST} serveriga kirdi (spawn).`);

    setTimeout(() => {
      runLoginAndCommands();
    }, 6000);

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
    activeBot = null;
    scheduleReconnect('Kick qilindi');
  });

  bot.on('end', (reason) => {
    console.log('[END]', reason || 'Ulanish yopildi');
    activeBot = null;
    scheduleReconnect('Sessiya tugadi');
  });

  bot.on('error', (err) => {
    console.log('[ERROR]', err.message);
    scheduleReconnect('Xatolik yuz berdi');
  });
}

startBot();
startTelegramPolling();
