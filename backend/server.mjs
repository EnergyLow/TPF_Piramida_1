import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const ADMIN_CHAT_IDS = [...new Set((process.env.ADMIN_CHAT_IDS || process.env.ADMIN_CHAT_ID || '').split(',').map(v => v.trim()).filter(Boolean))];
const ADMIN_CHAT_ID_SET = new Set(ADMIN_CHAT_IDS);
const POLL_TIMEOUT = Math.min(50, Math.max(1, Number.parseInt(process.env.TELEGRAM_POLL_TIMEOUT || '25', 10)));
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5500,http://localhost:5500').split(',').map(v => v.trim()).filter(Boolean));
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '12kb', strict: true }));
let writeQueue = Promise.resolve();
let polling = false;
let updateOffset = 0;
const rateBuckets = new Map();

function safeEqual(a, b) { return typeof a === 'string' && typeof b === 'string' && a.length > 0 && a === b; }
function cleanText(value, max) { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : ''; }
function corsAndOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ ok: false, error: 'Источник запроса не разрешён.' });
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
app.use(corsAndOrigin);
app.use((req, res, next) => {
  const now = Date.now(), key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = rateBuckets.get(key) || { count: 0, start: now };
  if (now - bucket.start > 10 * 60 * 1000) { bucket.count = 0; bucket.start = now; }
  bucket.count++; rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) for (const [ip, entry] of rateBuckets) if (now - entry.start > 10 * 60 * 1000) rateBuckets.delete(ip);
  if (bucket.count > 15 && req.path === '/api/bookings') return res.status(429).json({ ok: false, error: 'Слишком много попыток. Попробуйте позже или позвоните нам.' });
  next();
});
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return date >= today;
}
function validateBooking(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Проверьте данные формы.' };
  const name=cleanText(body.name,80), phone=cleanText(body.phone,32), date=cleanText(body.date,10), time=cleanText(body.time,5), guests=cleanText(String(body.guests ?? ''),3), comment=cleanText(body.comment,500);
  const digits=phone.replace(/\D/g,'');
  if (name.length < 2) return { error: 'Укажите имя (не менее двух символов).' };
  if (digits.length < 10 || digits.length > 15 || !/^[+\d\s().-]+$/.test(phone)) return { error: 'Укажите корректный номер телефона с кодом страны.' };
  if (!validDate(date)) return { error: 'Выберите корректную дату не в прошлом.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Выберите корректное время.' };
  if (!/^(?:[1-9]|[1-9]\d|100|7\+)$/.test(guests)) return { error: 'Укажите корректное количество гостей.' };
  if (body.consent !== true) return { error: 'Необходимо согласие на обработку персональных данных.' };
  return { value: { name, phone, date, time, guests, comment } };
}
async function readBookings() {
  try { const parsed=JSON.parse(await readFile(BOOKINGS_FILE,'utf8')); return Array.isArray(parsed)?parsed:[]; }
  catch (e) { if(e.code==='ENOENT') return []; throw e; }
}
function serialWrite(operation) { const next=writeQueue.then(operation,operation); writeQueue=next.catch(()=>{}); return next; }
async function persistBookings(bookings) {
  await mkdir(DATA_DIR,{recursive:true}); const temp=`${BOOKINGS_FILE}.tmp`;
  await writeFile(temp,`${JSON.stringify(bookings,null,2)}\n`,{encoding:'utf8',mode:0o600}); await rename(temp,BOOKINGS_FILE);
}
async function mutateBookings(mutator) { return serialWrite(async()=>{ const bookings=await readBookings(); const result=await mutator(bookings); await persistBookings(bookings); return result; }); }
async function telegramApi(method,payload,timeoutMs=15000) {
  if(!BOT_TOKEN) throw new Error('Telegram не настроен.');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.ok) { const error=new Error(`Telegram API returned ${response.status||'an error'}`); error.telegramDescription=cleanText(result?.description||'Telegram API отклонил запрос.',200); throw error; }
    return result.result;
  } finally { clearTimeout(timer); }
}
function formatDate(date) { const [y,m,d]=date.split('-'); return `${d}.${m}.${y}`; }
function statusLabel(status) { return status==='confirmed'?'✅ Подтверждена':status==='rejected'?'❌ Отклонена':status==='notification_failed'?'⚠️ Ошибка уведомления администратору':'⏳ Ожидает подтверждения'; }
function escapeHtml(v) { return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
function bookingMessage(b) { return ['🔔 <b>Новая заявка на бронирование — «Пирамида»</b>','',`Номер заявки: <b>#${b.number}</b>`,`👤 Имя: ${escapeHtml(b.name)}`,`📞 Телефон: ${escapeHtml(b.phone)}`,`📅 Дата: ${formatDate(b.date)}`,`🕒 Время: ${b.time}`,`👥 Гостей: ${b.guests==='7+'?'7 и более':b.guests}`,`💬 Комментарий: ${escapeHtml(b.comment||'Не указан')}`,'',`Статус: ${statusLabel(b.status)}`].join('\n'); }
function bookingKeyboard(b) { return {inline_keyboard:[[{text:'✅ Подтвердить',callback_data:`confirm:${b.id}`},{text:'❌ Отклонить',callback_data:`reject:${b.id}`}]]}; }

app.get('/api/health',(_req,res)=>res.json({ok:true,service:'piramida-booking',telegramConfigured:Boolean(BOT_TOKEN&&ADMIN_CHAT_IDS.length)}));
app.post('/api/bookings',async(req,res)=>{
  if(!BOT_TOKEN||!ADMIN_CHAT_IDS.length) return res.status(503).json({ok:false,error:'Онлайн-бронирование пока не настроено. Позвоните: +7 (959) 505-10-25.'});
  const validation=validateBooking(req.body); if(validation.error) return res.status(400).json({ok:false,error:validation.error});
  try {
    const booking=await mutateBookings(async bookings=>{
      const number=bookings.reduce((max,item)=>Math.max(max,Number(item.number)||0),0)+1;
      const item={id:randomUUID(),number,...validation.value,status:'pending',statusLabel:'Ожидает подтверждения',createdAt:new Date().toISOString(),telegramMessageId:null,telegramChatId:ADMIN_CHAT_IDS[0],telegramMessages:[],notificationError:null};
      bookings.push(item); return item;
    });
    const sentMessages=[];
    const notificationFailures=[];
    for (const chatId of ADMIN_CHAT_IDS) {
      try {
        const msg=await telegramApi('sendMessage',{chat_id:chatId,text:bookingMessage(booking),parse_mode:'HTML',reply_markup:bookingKeyboard(booking)});
        sentMessages.push({chatId:String(msg.chat.id),messageId:msg.message_id});
      } catch(error) {
        const reason=error.telegramDescription||'Telegram API недоступен';
        notificationFailures.push({chatId,reason});
        console.error(`Не удалось отправить заявку #${booking.number} администратору ${chatId}: ${reason}`);
      }
    }
    if (sentMessages.length) {
      await mutateBookings(async bookings=>{
        const item=bookings.find(x=>x.id===booking.id);
        if(item){
          item.telegramMessages=sentMessages;
          item.telegramMessageId=sentMessages[0]?.messageId??null;
          item.telegramChatId=sentMessages[0]?.chatId??null;
          item.notifiedAt=new Date().toISOString();
          item.notificationFailures=notificationFailures;
          item.notificationError=notificationFailures.length ? 'Не всем администраторам удалось доставить уведомление. Проверьте, что каждый администратор нажал Start у бота и указал правильный числовой ID.' : null;
        }
      });
    } else {
      const reason=notificationFailures.map(f=>`${f.chatId}: ${f.reason}`).join('; ');
      await mutateBookings(async bookings=>{const item=bookings.find(x=>x.id===booking.id);if(item){item.status='notification_failed';item.statusLabel='Ошибка отправки уведомления';item.notificationError=reason||'Telegram API недоступен';}}).catch(()=>{});
      return res.status(502).json({ok:false,error:'Не удалось отправить заявку ни одному администратору. Проверьте Telegram ID и попросите каждого администратора нажать Start у бота.'});
    }
    return res.status(201).json({ok:true,bookingNumber:booking.number,message:'Заявка отправлена! Администратор свяжется с вами для подтверждения бронирования. Это ещё не подтверждение столика.'});
  } catch { return res.status(500).json({ok:false,error:'Не удалось сохранить заявку. Попробуйте ещё раз или позвоните в заведение.'}); }
});

async function handleCallback(callback) {
  const callbackId=callback.id, actorId=String(callback.from?.id??''), chatId=String(callback.message?.chat?.id??''), data=typeof callback.data==='string'?callback.data:'';
  if(!ADMIN_CHAT_ID_SET.has(actorId)||!safeEqual(chatId,actorId)) { await telegramApi('answerCallbackQuery',{callback_query_id:callbackId,text:'Это действие доступно только администратору.',show_alert:true}); return; }
  const match=/^(confirm|reject):([0-9a-f-]{36})$/.exec(data);
  if(!match) { await telegramApi('answerCallbackQuery',{callback_query_id:callbackId,text:'Некорректное действие.'}); return; }
  const [,action,id]=match;
  const outcome=await mutateBookings(async bookings=>{
    const booking=bookings.find(x=>x.id===id); if(!booking)return {kind:'missing'};
    if(booking.status!=='pending')return {kind:'closed',booking};
    booking.status=action==='confirm'?'confirmed':'rejected'; booking.statusLabel=action==='confirm'?'Подтверждена':'Отклонена'; booking.updatedAt=new Date().toISOString(); return {kind:'updated',booking};
  });
  if(outcome.kind==='missing'){await telegramApi('answerCallbackQuery',{callback_query_id:callbackId,text:'Заявка не найдена.',show_alert:true});return;}
  if(outcome.kind==='closed'){await telegramApi('answerCallbackQuery',{callback_query_id:callbackId,text:`Заявка уже обработана: ${statusLabel(outcome.booking.status)}`,show_alert:true});return;}
  try {
    const b=outcome.booking;
    const messages=Array.isArray(b.telegramMessages)&&b.telegramMessages.length?b.telegramMessages:(b.telegramMessageId&&b.telegramChatId?[{chatId:b.telegramChatId,messageId:b.telegramMessageId}]:[]);
    for (const msg of messages) {
      try { await telegramApi('editMessageText',{chat_id:msg.chatId,message_id:msg.messageId,text:bookingMessage(b),parse_mode:'HTML',reply_markup:{inline_keyboard:[]}}); }
      catch (error) { console.error(`Не удалось обновить копию заявки #${b.number} для одного из администраторов: ${error.telegramDescription||'ошибка Telegram API'}`); }
    }
    await telegramApi('answerCallbackQuery',{callback_query_id:callbackId,text:action==='confirm'?'Заявка подтверждена.':'Заявка отклонена.'});
  } catch {
    try { await telegramApi('answerCallbackQuery',{callback_query_id:callbackId,text:'Статус сохранён, но сообщение не удалось обновить. Проверьте сервер.',show_alert:true}); } catch {}
    console.error('Статус заявки сохранён, но Telegram не смог обновить сообщение.');
  }
}
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Слишком большой запрос.' });
  if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) return res.status(400).json({ ok: false, error: 'Некорректный JSON в запросе.' });
  console.error('Необработанная ошибка API запроса.');
  return res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера.' });
});

async function startTelegramPolling() {
  if(!BOT_TOKEN||!ADMIN_CHAT_IDS.length){console.warn('Telegram не настроен: заполните BOT_TOKEN и ADMIN_CHAT_IDS в backend/.env. API бронирования пока отключён.');return;}
  const invalidAdminIds=ADMIN_CHAT_IDS.filter(id=>! /^-?\d+$/.test(id));
  if(invalidAdminIds.length)throw new Error('ADMIN_CHAT_IDS должен содержать только числовые Telegram chat ID через запятую.');
  try {
    const webhook=await telegramApi('getWebhookInfo',{});
    if(webhook?.url)throw new Error('У бота уже настроен webhook. Сервер не удалял его. Отключите webhook осознанно перед запуском long polling.');
    const me=await telegramApi('getMe',{}); console.log(`Telegram bot подключён: @${me.username||'unknown'}. Long polling активен.`);
  } catch(error) { if(error.message.includes('webhook'))throw error; console.error('Не удалось проверить Telegram API. Проверьте BOT_TOKEN, сеть и доступ бота.');return; }
  polling=true; pollLoop().catch(()=>{polling=false;console.error('Long polling остановлен. Проверьте соединение и перезапустите сервер.');});
}
async function pollLoop() {
  while(polling) {
    try {
      const updates=await telegramApi('getUpdates',{offset:updateOffset,timeout:POLL_TIMEOUT,allowed_updates:['callback_query']},(POLL_TIMEOUT+10)*1000);
      for(const update of updates){updateOffset=Math.max(updateOffset,update.update_id+1);if(update.callback_query){try{await handleCallback(update.callback_query);}catch{console.error('Не удалось обработать действие Telegram. Проверьте соединение и заявку.');}}}
    } catch(error) {
      if(error.telegramDescription?.includes('Conflict')){console.error('Конфликт getUpdates: возможно, уже запущен другой экземпляр бота.');polling=false;return;}
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  }
}
await mkdir(DATA_DIR,{recursive:true});
const server=app.listen(PORT,()=>{console.log(`Piramida booking API слушает http://localhost:${PORT}`);startTelegramPolling().catch(error=>{console.error(error.message||'Не удалось запустить Telegram polling.');server.close(()=>process.exit(1));});});
async function shutdown(){polling=false;server.close(()=>process.exit(0));}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
