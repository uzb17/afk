const http = require('http');
const mineflayer = require('mineflayer');

// ================= ENV SOZLAMALARI =================
const TG_TOKEN = process.env.TG_TOKEN || '';
const OWNER_ID = Number(process.env.OWNER_ID || 0);

const MC_HOST = process.env.MC_HOST || 'frokamc.uz';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.21.11';
const SHARED_PASS = process.env.MC_PASS || '123456';

const ACCOUNTS_CONFIG = [
  {
    id: '1',
    username: process.env.MC_USER_1 || process.env.MC_USER || 'uzcraft',
    password: SHARED_PASS
  },
  {
    id: '2',
    username: process.env.MC_USER_2 || 'moddie',
    password: SHARED_PASS
  }
].filter((acc) => acc.username && acc.password);
// ===================================================

// Render uxlab qolmasligi uchun mini HTTP server
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Multi-account AFK bot (${ACCOUNTS_CONFIG.map((a) => a.username).join(', ')}) is running\n`);
}).listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

const accountsState = new Map();
let activeAccountId = ACCOUNTS_CONFIG[0]?.id || '1';

let chatRelayEnabled = true;
let chatBuffer = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min = 200, max = 500) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function getActiveAccount() {
  return accountsState.get(activeAccountId) || accountsState.values().next().value;
}

async function tgApi(method, payload) {
  if (!TG_TOKEN) return null;
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function sendTgMessage(chatId, text, replyMarkup = null) {
  if (!TG_TOKEN || !chatId || !text) return;
  try {
    const body = {
      chat_id: chatId,
      text: text.slice(0, 4000)
    };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await tgApi('sendMessage', body);
  } catch (err) {
    console.log('[TG SEND ERROR]', err.message);
  }
}

function notifyOwner(text) {
  if (!OWNER_ID) return;
  sendTgMessage(OWNER_ID, text);
}

// "/" bosilganda chiqadigan buyruqlar menyusi
async function registerBotCommands() {
  if (!TG_TOKEN) return;
  const commands = [
    { command: 'switch', description: 'Faol akkauntni almashtirish (uzcraft / moddie)' },
    { command: 'online', description: 'Faol akkaunt ko‘rayotgan online o‘yinchilar' },
    { command: 'drop', description: 'Faol akkaunt inventarini hozir tashlash' },
    { command: 'status', description: 'uzcraft va moddie holati' },
    { command: 'chat', description: 'MC chatni Telegramga yuborishni yoqish/o‘chirish' },
    { command: 'reconnect', description: 'Faol akkauntni qayta ulash' },
    { command: 'help', description: 'Yordam va boshqaruv qoidalari' }
  ];

  try {
    const data = await tgApi('setMyCommands', { commands });
    if (data?.ok) {
      console.log('[TG] Buyruqlar menyusi (/) o‘rnatildi.');
    } else {
      console.log('[TG] setMyCommands xatosi:', data?.description);
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

function setActiveAccountByKey(key, chatId) {
  const normalized = String(key).toLowerCase();
  let target = accountsState.get(normalized);

  // Nik bo'yicha ham almashtirish imkoni (/switch moddie yoki /switch uzcraft)
  if (!target) {
    for (const acc of accountsState.values()) {
      if (acc.config.username.toLowerCase() === normalized) {
        target = acc;
        break;
      }
    }
  }

  if (!target) {
    sendTgMessage(
      chatId,
      `❌ "${key}" akkaunti topilmadi. Mavjudlari: uzcraft (1), moddie (2)`
    );
    return;
  }

  activeAccountId = target.config.id;
  const onlineMark = target.bot && target.bot.entity ? '🟢 Online' : '🔴 Offline';
  sendTgMessage(
    chatId,
    `🔀 Faol akkaunt o‘zgartirildi:\n👉 [${target.config.id}] ${target.config.username} (${onlineMark})`
  );
}

// Telegramdan kelgan xabarlar va inline tugmalarni tinglash
async function startTelegramPolling() {
  if (!TG_TOKEN) {
    console.log('[TG] TG_TOKEN o‘rnatilmagan, Telegram bot o‘chiq.');
    return;
  }

  await registerBotCommands();

  let offset = 0;
  const accListText = ACCOUNTS_CONFIG.map((a) => `[${a.id}] ${a.username}`).join(', ');
  console.log('[TG] Telegram bot tinglashni boshladi...');
  notifyOwner(`🤖 Telegram boshqaruv moduli ishga tushdi.\nAkkauntlar: ${accListText}`);

  while (true) {
    try {
      const data = await tgApi('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query']
      });

      if (data?.ok && Array.isArray(data.result) && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          // Inline tugma bosilganda (/switch menyusidan)
          if (update.callback_query) {
            const cb = update.callback_query;
            const userId = cb.from?.id;
            const chatId = cb.message?.chat?.id;

            if (!OWNER_ID || userId !== OWNER_ID) {
              await tgApi('answerCallbackQuery', {
                callback_query_id: cb.id,
                text: 'Ruxsat yo‘q',
                show_alert: true
              });
              continue;
            }

            if (cb.data && cb.data.startsWith('switch_')) {
              const targetId = cb.data.replace('switch_', '');
              setActiveAccountByKey(targetId, chatId);
              await tgApi('answerCallbackQuery', {
                callback_query_id: cb.id,
                text: 'Akkaunt tanlandi'
              });
            }
            continue;
          }

          const msg = update.message;
          if (!msg || !msg.text) continue;

          if (!OWNER_ID || msg.from.id !== OWNER_ID) {
            await sendTgMessage(msg.chat.id, '⛔ Sizda bu botni boshqarish huquqi yo‘q.');
            continue;
          }

          const rawText = msg.text.trim();
          const parts = rawText.split(/\s+/);
          const cmd = parts[0].toLowerCase();

          if (cmd === '/start' || cmd === '/help') {
            const active = getActiveAccount();
            await sendTgMessage(
              msg.chat.id,
              `✅ Multi-Account MC Bot ulangan!\n` +
              `👉 Hozirgi faol akkaunt: [${active?.config.id}] ${active?.config.username}\n\n` +
              '• /switch — uzcraft / moddie orasida almashtirish\n' +
              '• /online — faol akkaunt ko‘rayotgan o‘yinchilar\n' +
              '• /drop — faol akkaunt inventarini hozir tashlash\n' +
              '• /status — uzcraft va moddie holati\n' +
              '• /chat — MC chat xabarlarini yoqish/o‘chirish\n' +
              '• /reconnect — faol akkauntni qayta ulash\n\n' +
              'Buyruq yuborish (faqat faol akkauntga ketadi):\n' +
              '• mc /pay casxuz 100k\n' +
              '• Salom hammaga'
            );
            continue;
          }

          if (cmd === '/switch') {
            if (parts[1]) {
              setActiveAccountByKey(parts[1], msg.chat.id);
            } else {
              const buttons = Array.from(accountsState.values()).map((acc) => {
                const isCurrent = acc.config.id === activeAccountId ? ' ✅' : '';
                const isOnline = acc.bot && acc.bot.entity ? '🟢' : '🔴';
                return {
                  text: `${isOnline} [${acc.config.id}] ${acc.config.username}${isCurrent}`,
                  callback_data: `switch_${acc.config.id}`
                };
              });

              await sendTgMessage(
                msg.chat.id,
                '🔀 Qaysi akkauntga buyruq yuborishni tanlang:',
                { inline_keyboard: [buttons] }
              );
            }
            continue;
          }

          if (cmd === '/online') {
            const active = getActiveAccount();
            const bot = active?.bot;
            if (bot && bot.players) {
              const playerNames = Object.keys(bot.players);
              const list = playerNames.length > 0 ? playerNames.join(', ') : 'Hech kim topilmadi';
              await sendTgMessage(
                msg.chat.id,
                `👥 [${active.config.username}] — Online o‘yinchilar (${playerNames.length} ta):\n${list}`
              );
            } else {
              await sendTgMessage(msg.chat.id, `🔴 [${active?.config.username || activeAccountId}] hozir serverda emas.`);
            }
            continue;
          }

          if (cmd === '/drop') {
            const active = getActiveAccount();
            const bot = active?.bot;
            if (bot && bot.entity) {
              const count = await dropAllItems(active, true);
              if (count === 0) {
                await sendTgMessage(msg.chat.id, `🎒 [${active.config.username}] inventari allaqachon bo‘sh.`);
              } else {
                await sendTgMessage(msg.chat.id, `🗑 [${active.config.username}] inventaridagi ${count} ta slot tashlandi.`);
              }
            } else {
              await sendTgMessage(msg.chat.id, `🔴 [${active?.config.username || activeAccountId}] serverda emas.`);
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
            const lines = [];
            for (const acc of accountsState.values()) {
              const mark = acc.config.id === activeAccountId ? '👉 ' : '';
              if (acc.bot && acc.bot.entity) {
                const pos = acc.bot.entity.position;
                const itemsCount = acc.bot.inventory ? acc.bot.inventory.items().length : 0;
                lines.push(
                  `${mark}🟢 [${acc.config.id}] ${acc.config.username} — Online\n` +
                  `   📍 X:${Math.round(pos.x)} Y:${Math.round(pos.y)} Z:${Math.round(pos.z)} | 🎒 ${itemsCount} slot`
                );
              } else {
                lines.push(`${mark}🔴 [${acc.config.id}] ${acc.config.username} — Offline / Ulanmoqda`);
              }
            }
            await sendTgMessage(
              msg.chat.id,
              `📊 Akkauntlar holati:\n\n${lines.join('\n\n')}\n\n💬 Chat uzatish: ${chatRelayEnabled ? 'Yoqilgan' : 'O‘chirilgan'}`
            );
            continue;
          }

          if (cmd === '/reconnect') {
            const active = getActiveAccount();
            if (!active) continue;
            await sendTgMessage(msg.chat.id, `🔄 [${active.config.username}] qayta ulanilmoqda...`);
            if (active.bot) {
              try {
                active.bot.quit();
              } catch (_) {}
            }
            scheduleReconnect(active, 'Telegram orqali qayta ulash');
            continue;
          }

          // Qolgan barcha buyruq va matnlarni faqat FAOL akkauntga yuborish
          const active = getActiveAccount();
          let mcText = rawText;
          if (/^mc\s+/i.test(rawText)) {
            mcText = rawText.replace(/^mc\s+/i, '').trim();
          }

          if (mcText && active?.bot && active.bot.entity) {
            active.bot.chat(mcText);
            console.log(`[TG -> MC:${active.config.username}] ${mcText}`);
            await sendTgMessage(msg.chat.id, `📤 [${active.config.username}] ga yuborildi: ${mcText}`);
          } else {
            await sendTgMessage(
              msg.chat.id,
              `🔴 [${active?.config.username || activeAccountId}] hozir serverda emas, biroz kuting.`
            );
          }
        }
      }
    } catch (err) {
      console.log('[TG POLL ERROR]', err.message);
      await sleep(5000);
    }
  }
}

function cleanupAccountTimers(acc) {
  if (acc.antiAfkInterval) {
    clearInterval(acc.antiAfkInterval);
    acc.antiAfkInterval = null;
  }
  if (acc.dropItemsInterval) {
    clearInterval(acc.dropItemsInterval);
    acc.dropItemsInterval = null;
  }
  if (acc.reconnectTimeout) {
    clearTimeout(acc.reconnectTimeout);
    acc.reconnectTimeout = null;
  }
}

function scheduleReconnect(acc, reason) {
  if (acc.isReconnecting) return;
  acc.isReconnecting = true;
  cleanupAccountTimers(acc);
  console.log(`[RECONNECT:${acc.config.username}] ${reason}. 15 soniyadan keyin qayta ulanadi...`);
  notifyOwner(`⚠️ [${acc.config.username}] ${reason}. 15 soniyadan keyin qayta ulanadi...`);
  acc.reconnectTimeout = setTimeout(() => {
    acc.isReconnecting = false;
    startAccountBot(acc);
  }, 15000);
}

async function dropAllItems(acc, isManual = false) {
  const bot = acc.bot;
  if (!bot || !bot.inventory) return 0;
  const items = bot.inventory.items();
  if (items.length === 0) return 0;

  console.log(`[INVENTORY:${acc.config.username}] (${isManual ? 'MANUAL' : 'AUTO'}) ${items.length} ta slot tashlanmoqda...`);
  let droppedCount = 0;

  for (const item of items) {
    try {
      await bot.tossStack(item);
      droppedCount++;
      await sleep(randomDelay(200, 500));
    } catch (err) {
      console.log(`[DROP ERROR:${acc.config.username}]`, err.message);
    }
  }

  return droppedCount;
}

function startAccountBot(acc) {
  cleanupAccountTimers(acc);

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: acc.config.username,
    version: MC_VERSION
  });

  acc.bot = bot;
  let loginSent = false;

  function runLoginAndCommands() {
    if (loginSent) return;
    loginSent = true;

    console.log(`[CMD:${acc.config.username}] /login yuborilmoqda...`);
    bot.chat(`/login ${acc.config.password}`);

    setTimeout(() => {
      console.log(`[CMD:${acc.config.username}] /server anarxiya2 yuborilmoqda...`);
      bot.chat('/server anarxiya2');
    }, 6000);

    setTimeout(() => {
      console.log(`[CMD:${acc.config.username}] /pay casxuz 1m yuborilmoqda...`);
      bot.chat('/pay casxuz 1m');
    }, 14000);

    setTimeout(() => {
      console.log(`[CMD:${acc.config.username}] /tpa casxuz yuborilmoqda...`);
      bot.chat('/tpa casxuz');
    }, 19000);
  }

  bot.once('spawn', () => {
    console.log(`[BOT:${acc.config.username}] Serverga ulanildi (spawn).`);
    notifyOwner(`🟢 [${acc.config.username}] ${MC_HOST} serveriga kirdi (spawn).`);

    setTimeout(() => {
      runLoginAndCommands();
    }, 6000);

    acc.antiAfkInterval = setInterval(() => {
      if (!bot.entity) return;
      const yaw = bot.entity.yaw + (Math.random() * 0.4 - 0.2);
      const pitch = Math.max(-0.5, Math.min(0.5, bot.entity.pitch + (Math.random() * 0.2 - 0.1)));
      bot.look(yaw, pitch, false).catch(() => {});
      bot.setControlState('jump', true);
      setTimeout(() => {
        bot.setControlState('jump', false);
      }, randomDelay(200, 500));
    }, 45000);

    acc.dropItemsInterval = setInterval(() => {
      dropAllItems(acc, false);
    }, 3 * 60 * 1000);
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    if (!text) return;
    console.log(`[CHAT:${acc.config.username}]`, text);

    if (chatRelayEnabled) {
      chatBuffer.push(`[${acc.config.username}] ${text}`);
    }

    const lower = text.toLowerCase();
    if (!loginSent && (lower.includes('/login') || lower.includes('/ʟᴏɢɪɴ'))) {
      setTimeout(() => {
        runLoginAndCommands();
      }, 3000);
    }
  });

  bot.on('kicked', (reason) => {
    console.log(`[KICKED:${acc.config.username}]`, reason);
    acc.bot = null;
    scheduleReconnect(acc, 'Kick qilindi');
  });

  bot.on('end', (reason) => {
    console.log(`[END:${acc.config.username}]`, reason || 'Ulanish yopildi');
    acc.bot = null;
    scheduleReconnect(acc, 'Sessiya tugadi');
  });

  bot.on('error', (err) => {
    console.log(`[ERROR:${acc.config.username}]`, err.message);
    scheduleReconnect(acc, 'Xatolik yuz berdi');
  });
}

// uzcraft va moddie akkauntlarini 5 soniya oraliq bilan ishga tushirish
(async () => {
  for (let i = 0; i < ACCOUNTS_CONFIG.length; i++) {
    const cfg = ACCOUNTS_CONFIG[i];
    const accState = {
      config: cfg,
      bot: null,
      antiAfkInterval: null,
      dropItemsInterval: null,
      reconnectTimeout: null,
      isReconnecting: false
    };
    accountsState.set(cfg.id, accState);
    startAccountBot(accState);

    if (i < ACCOUNTS_CONFIG.length - 1) {
      await sleep(5000);
    }
  }
  startTelegramPolling();
})();
