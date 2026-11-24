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

let chatRelayEnabled = true;
let chatBuffer = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min = 200, max = 500) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

async function sendTgMessage(chatId, text) {
  if (!TG_TOKEN || !chatId || !text) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000)
      })
    });
  } catch (err) {
    console.log('[TG SEND ERROR]', err.message);
  }
}

function notifyOwner(text) {
  if (!OWNER_ID) return;
  sendTgMessage(OWNER_ID, text);
}

// Telegramda "/" bosilganda buyruqlar ro'yxatini avtomatik ko'rsatish uchun ro'yxatdan o'tkazish
async function registerBotCommands() {
  if (!TG_TOKEN) return;
  const commands = [
    { command: 'online', description: 'Serverdagi online o‘yinchilarni ko‘rish' },
    { command: 'drop', description: 'Inventardagi narsalarni hozir tashlash' },
    { command: 'status', description: 'Bot holati va koordinatasi' },
    { command: 'chat', description: 'MC chatni Telegramga yuborishni yoqish/o‘chirish' },
    { command: 'reconnect', description: 'Serverga qayta ulanish' },
    { command: 'help', description: 'Yordam va foydalanish qoidalari' }
  ];

  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });
    const data = await res.json();
    if (data.ok) {
      console.log('[TG] Buyruqlar menyusi (/) muvaffaqiyatli o‘rnatildi.');
    } else {
      console.log('[TG] setMyCommands xatosi:', data.description);
    }
  } catch (err) {
    console.log('[TG COMMANDS ERROR]', err.message);
  }
}

// Har 2.5 soniyada yig'ilgan MC chat xabarlarini bitta qilib Telegramga yuborish
setInterval(() => {
  if (!chatRelayEnabled || chatBuffer.length === 0 || !OWNER_ID) return;
  const combined = chatBuffer.splice(0, chatBuffer.length).join('\n');
  notifyOwner(`💬 MC Chat:\n${combined}`);
}, 2500);

// Telegramdan kelgan xabarlarni tinglash
async function startTelegramPolling() {
  if (!TG_TOKEN) {
    console.log('[TG] TG_TOKEN o‘rnatilmagan, Telegram bot o‘chiq.');
    return;
  }

  await registerBotCommands();

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

          const rawText = msg.text.trim();
          const cmd = rawText.split(' ')[0].toLowerCase();

          if (cmd === '/start' || cmd === '/help') {
            await sendTgMessage(
              msg.chat.id,
              `✅ ${MC_USER} MC Bot ulangan!\n\n` +
              '• /online — serverda kimlar borligini ko‘rish\n' +
              '• /drop — inventardagi narsalarni hozir tashlash\n' +
              '• /status — bot koordinatasi va holati\n' +
              '• /chat — MC chat xabarlarini yoqish/o‘chirish\n' +
              '• /reconnect — serverga qayta ulanish\n\n' +
              'Minecraftga buyruq yoki matn yuborish:\n' +
              '• mc /pay casxuz 100k — o‘yinga /pay buyrug‘ini yuboradi\n' +
              '• Salom hammaga — o‘yinga oddiy xabar yuboradi'
            );
            continue;
          }

          if (cmd === '/online') {
            if (activeBot && activeBot.players) {
              const playerNames = Object.keys(activeBot.players);
              const list = playerNames.length > 0 ? playerNames.join(', ') : 'Hech kim topilmadi';
              await sendTgMessage(
                msg.chat.id,
                `👥 Online o‘yinchilar (${playerNames.length} ta):\n${list}`
              );
            } else {
              await sendTgMessage(msg.chat.id, '🔴 Bot hozir serverda emas.');
            }
            continue;
          }

          if (cmd === '/drop') {
            if (activeBot && activeBot.entity) {
              const count = await dropAllItems(activeBot, true);
              if (count === 0) {
                await sendTgMessage(msg.chat.id, '🎒 Inventar allaqachon bo‘sh.');
              } else {
                await sendTgMessage(msg.chat.id, `🗑 Inventardagi ${count} ta slot tashlab yuborildi.`);
              }
            } else {
              await sendTgMessage(msg.chat.id, '🔴 Bot serverda emas.');
            }
            continue;
          }

          if (cmd === '/chat') {
            chatRelayEnabled = !chatRelayEnabled;
            chatBuffer = [];
            await sendTgMessage(
              msg.chat.id,
              chatRelayEnabled
                ? '🔔 MC chat xabarlarini Telegramga yuborish YOQILDI.'
                : '🔕 MC chat xabarlarini Telegramga yuborish O‘CHIRILDI.'
            );
            continue;
          }

          if (cmd === '/status') {
            if (activeBot && activeBot.entity) {
              const pos = activeBot.entity.position;
              const itemsCount = activeBot.inventory ? activeBot.inventory.items().length : 0;
              await sendTgMessage(
                msg.chat.id,
                `🟢 Bot serverda (Online)\n` +
                `📍 Koordinata: X:${Math.round(pos.x)} Y:${Math.round(pos.y)} Z:${Math.round(pos.z)}\n` +
                `🎒 Inventar slotlari: ${itemsCount}\n` +
                `💬 Chat uzatish: ${chatRelayEnabled ? 'Yoqilgan' : 'O‘chirilgan'}`
              );
            } else {
              await sendTgMessage(msg.chat.id, '🔴 Bot hozir serverda emas yoki ulanmoqda.');
            }
            continue;
          }

          if (cmd === '/reconnect') {
            await sendTgMessage(msg.chat.id, '🔄 Qayta ulanilmoqda...');
            if (activeBot) activeBot.quit();
            scheduleReconnect('Telegram orqali qayta ulash');
            continue;
          }

          // Agar foydalanuvchi "mc /spawn" yoki "mc salom" deb yozsa, "mc " ni olib tashlab MC ga yuboradi
          let mcText = rawText;
          if (/^mc\s+/i.test(rawText)) {
            mcText = rawText.replace(/^mc\s+/i, '').trim();
          }

          if (mcText && activeBot && activeBot.entity) {
            activeBot.chat(mcText);
            console.log(`[TG -> MC] ${mcText}`);
            await sendTgMessage(msg.chat.id, `📤 O‘yinga yuborildi: ${mcText}`);
          } else if (!activeBot || !activeBot.entity) {
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

async function dropAllItems(bot, isManual = false) {
  if (!bot.inventory) return 0;
  const items = bot.inventory.items();
  if (items.length === 0) return 0;

  console.log(`[INVENTORY] (${isManual ? 'MANUAL' : 'AUTO'}) ${items.length} ta slot tashlanmoqda...`);
  let droppedCount = 0;

  for (const item of items) {
    try {
      await bot.tossStack(item);
      droppedCount++;
      await sleep(randomDelay(200, 500));
    } catch (err) {
      console.log('[DROP ERROR]', err.message);
    }
  }

  return droppedCount;
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
      dropAllItems(bot, false);
    }, 3 * 60 * 1000);
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    if (!text) return;
    console.log('[CHAT]', text);

    if (chatRelayEnabled) {
      chatBuffer.push(text);
    }

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
