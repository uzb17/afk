const http = require('http');
const zlib = require('zlib');
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
      text: String(text).slice(0, 4000)
    };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await tgApi('sendMessage', body);
  } catch (err) {
    console.log('[TG SEND ERROR]', err.message);
  }
}

async function sendTgPhotoBuffer(chatId, pngBuffer, caption = '') {
  if (!TG_TOKEN || !chatId || !pngBuffer) return;
  try {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('caption', String(caption).slice(0, 1000));
    formData.append(
      'photo',
      new Blob([pngBuffer], { type: 'image/png' }),
      'map_captcha.png'
    );

    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData
    });
    await res.json();
  } catch (err) {
    console.log('[TG PHOTO ERROR]', err.message);
  }
}

function notifyOwner(text) {
  if (!OWNER_ID || !TG_TOKEN) return;
  sendTgMessage(OWNER_ID, text);
}

function mapDataToPngBuffer(dataBytes, width = 128, height = 128) {
  if (!dataBytes || dataBytes.length < width * height) return null;

  const palette = [
    [0, 0, 0],
    [127, 178, 56], [247, 233, 163], [199, 199, 199], [255, 0, 0],
    [160, 160, 255], [167, 167, 167], [0, 124, 0], [255, 255, 255],
    [164, 168, 184], [151, 109, 77], [112, 112, 112], [64, 64, 255],
    [143, 119, 72], [255, 252, 245], [216, 127, 51], [178, 76, 216],
    [102, 153, 216], [229, 229, 51], [127, 204, 25], [242, 127, 165],
    [76, 76, 76], [153, 153, 153], [76, 127, 153], [127, 63, 178],
    [51, 76, 178], [102, 76, 51], [102, 127, 51], [153, 51, 51],
    [25, 25, 25], [250, 238, 77], [92, 219, 213], [74, 128, 255],
    [0, 217, 58], [129, 86, 49], [112, 2, 0]
  ];

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const val = dataBytes[y * width + x] & 0xff;
      const colorId = val >> 2;
      const shadeId = val & 3;
      const base = palette[colorId] || [255, 255, 255];
      const mult = shadeId === 0 ? 0.71 : shadeId === 1 ? 0.86 : shadeId === 2 ? 1.0 : 0.53;

      const px = rowStart + 1 + x * 4;
      raw[px] = Math.min(255, Math.round(base[0] * mult));
      raw[px + 1] = Math.min(255, Math.round(base[1] * mult));
      raw[px + 2] = Math.min(255, Math.round(base[2] * mult));
      raw[px + 3] = val === 0 ? 0 : 255;
    }
  }

  const idatData = zlib.deflateSync(raw);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

async function lookDownAndSendPrompt(acc) {
  const bot = acc.bot;
  if (!bot || !bot.entity) return;

  try {
    await bot.look(bot.entity.yaw, Math.PI / 2, false);
  } catch (_) {}

  await sleep(400);

  const heldItem = bot.heldItem;
  const mapItem =
    (heldItem && heldItem.name === 'filled_map' && heldItem) ||
    (bot.inventory && bot.inventory.items().find((i) => i.name === 'filled_map'));

  let sentPhoto = false;
  if (mapItem && acc.lastMapData) {
    const png = mapDataToPngBuffer(acc.lastMapData);
    if (png && OWNER_ID) {
      await sendTgPhotoBuffer(
        OWNER_ID,
        png,
        `📸 [${acc.config.username}] pastga qaradi (Map). Davom etish uchun 1 ta xabar yuboring:`
      );
      sentPhoto = true;
    }
  }

  if (!sentPhoto) {
    notifyOwner(
      `📸 [${acc.config.username}] pastga qaradi!\n` +
      `Register/captcha tekshiruvi kutilmoqda. Davom etish uchun shu yerga 1 ta xabar yuboring (masalan: kod yoki "ok"):`
    );
  }
}

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

setInterval(() => {
  if (!chatRelayEnabled || !OWNER_ID || chatBuffer.length === 0) return;

  const linesToSend = [];
  let currentLength = 0;

  while (chatBuffer.length > 0) {
    const nextLine = chatBuffer[0];
    if (currentLength + nextLine.length + 1 > 3800 && linesToSend.length > 0) {
      break;
    }
    linesToSend.push(chatBuffer.shift());
    currentLength += nextLine.length + 1;
  }

  if (linesToSend.length > 0) {
    notifyOwner(`💬 MC Chat:\n${linesToSend.join('\n')}`);
  }
}, 2500);

function setActiveAccountByKey(key, chatId) {
  const normalized = String(key).toLowerCase();
  let target = accountsState.get(normalized);

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
              const rows = Array.from(accountsState.values()).map((acc) => {
                const isCurrent = acc.config.id === activeAccountId ? ' ✅' : '';
                const isOnline = acc.bot && acc.bot.entity ? '🟢' : '🔴';
                return [{
                  text: `${isOnline} [${acc.config.id}] ${acc.config.username}${isCurrent}`,
                  callback_data: `switch_${acc.config.id}`
                }];
              });

              await sendTgMessage(
                msg.chat.id,
                '🔀 Qaysi akkauntga buyruq yuborishni tanlang:',
                { inline_keyboard: rows }
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
                const waitTxt = acc.awaitingUserInput ? ' | ⏳ Xabar kutilmoqda' : '';
                lines.push(
                  `${mark}🟢 [${acc.config.id}] ${acc.config.username} — Online${waitTxt}\n` +
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
              active.bot = null;
            }
            scheduleReconnect(active, 'Telegram orqali qayta ulash');
            continue;
          }

          const active = getActiveAccount();
          if (active && active.awaitingUserInput && active.bot && active.bot.entity) {
            active.awaitingUserInput = false;

            const lowerInput = rawText.toLowerCase();
            if (lowerInput !== 'ok' && lowerInput !== 'davom' && lowerInput !== 'next') {
              const toSend = /^mc\s+/i.test(rawText)
                ? rawText.replace(/^mc\s+/i, '').trim()
                : rawText;
              if (toSend) {
                active.bot.chat(toSend);
                console.log(`[TG -> MC:${active.config.username} (USER STEP)] ${toSend}`);
              }
            }

            await sendTgMessage(
              msg.chat.id,
              `▶️ [${active.config.username}] qabul qilindi, login va keyingi vazifalar davom etmoqda...`
            );

            setTimeout(() => {
              if (typeof active.continueAfterUserInput === 'function') {
                active.continueAfterUserInput();
              }
            }, 1000);
            continue;
          }

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
  if (Array.isArray(acc.stepTimeouts)) {
    for (const t of acc.stepTimeouts) clearTimeout(t);
    acc.stepTimeouts = [];
  }
}

function scheduleReconnect(acc, reason) {
  if (acc.isReconnecting) return;
  acc.isReconnecting = true;
  acc.awaitingUserInput = false;
  acc.continueAfterUserInput = null;
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
  if (!bot || !bot.entity || !bot.inventory || acc.isDropping) return 0;

  const items = bot.inventory.items();
  if (items.length === 0) return 0;

  acc.isDropping = true;
  console.log(`[INVENTORY:${acc.config.username}] (${isManual ? 'MANUAL' : 'AUTO'}) ${items.length} ta slot tashlanmoqda...`);
  let droppedCount = 0;

  try {
    for (const item of items) {
      if (!acc.bot || acc.bot !== bot || !bot.entity) break;
      try {
        await bot.tossStack(item);
        droppedCount++;
        await sleep(randomDelay(200, 500));
      } catch (err) {
        console.log(`[DROP ERROR:${acc.config.username}]`, err.message);
      }
    }
  } finally {
    acc.isDropping = false;
  }

  return droppedCount;
}

function startAccountBot(acc) {
  cleanupAccountTimers(acc);
  acc.isDropping = false;
  acc.awaitingUserInput = false;
  acc.lastMapData = null;

  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: acc.config.username,
    version: MC_VERSION
  });

  acc.bot = bot;
  let loginSent = false;
  let promptTriggered = false;

  const addStepTimeout = (fn, delay) => {
    const id = setTimeout(() => {
      if (acc.bot === bot && bot.entity) fn();
    }, delay);
    acc.stepTimeouts.push(id);
  };

  function runLoginAndCommands() {
    if (loginSent || acc.bot !== bot || !bot.entity) return;
    loginSent = true;

    console.log(`[CMD:${acc.config.username}] /login yuborilmoqda...`);
    bot.chat(`/login ${acc.config.password}`);

    addStepTimeout(() => {
      console.log(`[CMD:${acc.config.username}] /server anarxiya2 yuborilmoqda...`);
      bot.chat('/server anarxiya2');
    }, 6000);

    addStepTimeout(() => {
      console.log(`[CMD:${acc.config.username}] /pay casxuz 1m yuborilmoqda...`);
      bot.chat('/pay casxuz 1m');
    }, 14000);

    addStepTimeout(() => {
      console.log(`[CMD:${acc.config.username}] /tpa casxuz yuborilmoqda...`);
      bot.chat('/tpa casxuz');
    }, 19000);
  }

  acc.continueAfterUserInput = () => {
    if (acc.bot !== bot || !bot.entity) return;
    runLoginAndCommands();
  };

  async function triggerLookDownAndWait() {
    if (promptTriggered || loginSent || acc.bot !== bot || !bot.entity) return;
    promptTriggered = true;
    acc.awaitingUserInput = true;
    await lookDownAndSendPrompt(acc);
  }

  if (bot._client) {
    bot._client.on('map', (packet) => {
      if (packet && packet.data) {
        acc.lastMapData = packet.data;
      }
    });
  }

  bot.once('spawn', () => {
    if (acc.bot !== bot) return;
    console.log(`[BOT:${acc.config.username}] Serverga ulanildi (spawn).`);
    notifyOwner(`🟢 [${acc.config.username}] ${MC_HOST} serveriga kirdi (spawn).`);

    addStepTimeout(() => {
      triggerLookDownAndWait();
    }, 2000);

    acc.antiAfkInterval = setInterval(() => {
      if (acc.bot !== bot || !bot.entity || acc.awaitingUserInput) return;
      const yaw = bot.entity.yaw + (Math.random() * 0.4 - 0.2);
      const pitch = Math.max(-0.5, Math.min(0.5, bot.entity.pitch + (Math.random() * 0.2 - 0.1)));
      bot.look(yaw, pitch, false).catch(() => {});
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (acc.bot === bot) bot.setControlState('jump', false);
      }, randomDelay(200, 500));
    }, 45000);

    acc.dropItemsInterval = setInterval(() => {
      if (!acc.awaitingUserInput) {
        dropAllItems(acc, false);
      }
    }, 3 * 60 * 1000);
  });

  bot.on('message', (jsonMsg) => {
    if (acc.bot !== bot) return;
    const text = jsonMsg.toString().trim();
    if (!text) return;
    console.log(`[CHAT:${acc.config.username}]`, text);

    if (chatRelayEnabled && OWNER_ID) {
      chatBuffer.push(`[${acc.config.username}] ${text}`);
    }

    const lower = text.toLowerCase();
    if (!loginSent && !promptTriggered && (lower.includes('/login') || lower.includes('/register') || lower.includes('/ʟᴏɢɪɴ'))) {
      addStepTimeout(() => {
        triggerLookDownAndWait();
      }, 1500);
    }
  });

  bot.on('kicked', (reason) => {
    if (acc.bot !== bot) return;
    console.log(`[KICKED:${acc.config.username}]`, reason);
    acc.bot = null;
    scheduleReconnect(acc, 'Kick qilindi');
  });

  bot.on('end', (reason) => {
    if (acc.bot !== bot) return;
    console.log(`[END:${acc.config.username}]`, reason || 'Ulanish yopildi');
    acc.bot = null;
    scheduleReconnect(acc, 'Sessiya tugadi');
  });

  bot.on('error', (err) => {
    if (acc.bot !== bot) return;
    console.log(`[ERROR:${acc.config.username}]`, err.message);
    acc.bot = null;
    scheduleReconnect(acc, 'Xatolik yuz berdi');
  });
}

(async () => {
  for (let i = 0; i < ACCOUNTS_CONFIG.length; i++) {
    const cfg = ACCOUNTS_CONFIG[i];
    const accState = {
      config: cfg,
      bot: null,
      antiAfkInterval: null,
      dropItemsInterval: null,
      reconnectTimeout: null,
      stepTimeouts: [],
      isReconnecting: false,
      isDropping: false,
      awaitingUserInput: false,
      continueAfterUserInput: null,
      lastMapData: null
    };
    accountsState.set(cfg.id, accState);
    startAccountBot(accState);

    if (i < ACCOUNTS_CONFIG.length - 1) {
      await sleep(5000);
    }
  }
  startTelegramPolling();
})();
