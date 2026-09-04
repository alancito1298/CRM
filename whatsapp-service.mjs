/**
 * WhatsApp Web Sidecar Service
 * 
 * Corre en puerto 3001 junto al CRM (puerto 3000).
 * - Mantiene la sesión de WhatsApp Web con LocalAuth
 * - API REST para enviar mensajes desde el CRM
 * - Recibe mensajes entrantes y los inserta en Supabase
 * 
 * Uso: node whatsapp-service.mjs
 */

import http from 'http';
import qrcode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth, MessageMedia } = pkg;

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.WA_SERVICE_PORT || 3001;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pjueqfhelyvejyubdkcr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqdWVxZmhlbHl2ZWp5dWJka2NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODUzOTkwOCwiZXhwIjoyMTA0MTE1OTA4fQ.ygA8b-Ns3pm2vT2yyL7eAA6rOnf24RRTAcJbPPFAVWo';
const CRM_PHONE = process.env.CRM_PHONE || '+5491154101146'; // Número del CRM

globalThis.WebSocket = class {};
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Estado ────────────────────────────────────────────────────────────────
let currentQR = null;
let status = 'initializing'; // initializing | qr | authenticated | ready | error
let whatsappClient = null;

// ─── Helpers ────────────────────────────────────────────────────────────────
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/^whatsapp:/i, '').replace(/[^0-9]/g, '');
}

function getPhoneVariants(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  const variants = [digits, `+${digits}`];
  if (digits.startsWith('549')) {
    const without9 = '54' + digits.slice(3);
    variants.push(without9, `+${without9}`);
  } else if (digits.startsWith('54')) {
    const with9 = '549' + digits.slice(2);
    variants.push(with9, `+${with9}`);
  }
  return [...new Set(variants)];
}

function toWAId(phone) {
  const digits = normalizePhone(phone);
  return `${digits}@c.us`;
}

const recentSentIds = new Set();

// ─── Resolver teléfono real a partir de LID o JID ─────────────────────────
async function resolveRealPhone(waId) {
  if (!waId) return '';
  const clean = normalizePhone(waId);

  // Si waId es un número normal (@c.us o sin @ con 10-13 dígitos), es teléfono directo
  if ((waId.endsWith('@c.us') || !waId.includes('@')) && clean.length >= 10 && clean.length <= 13) {
    return clean;
  }

  const fullId = waId.includes('@') ? waId : `${clean}@lid`;

  // 1. Intentar con getContactLidAndPhone oficial de whatsapp-web.js
  try {
    if (whatsappClient && typeof whatsappClient.getContactLidAndPhone === 'function') {
      const res = await whatsappClient.getContactLidAndPhone(fullId);
      if (Array.isArray(res) && res[0]?.pn) {
        const p = normalizePhone(res[0].pn);
        if (p) {
          console.log(`[WA-Service] 🎯 Resuelto LID ${fullId} → Teléfono real: +${p}`);
          return p;
        }
      }
    }
  } catch (err) {
    console.warn('[WA-Service] Error en getContactLidAndPhone:', err.message);
  }

  // 2. Intentar buscar en WWebJS / WAWebApiContact vía puppeteer
  try {
    if (whatsappClient?.pupPage) {
      const res = await whatsappClient.pupPage.evaluate(async (id) => {
        try {
          // A: enforceLidAndPnRetrieval
          if (window.WWebJS?.enforceLidAndPnRetrieval) {
            const pair = await window.WWebJS.enforceLidAndPnRetrieval(id);
            if (pair?.phone?._serialized) return pair.phone._serialized;
          }

          const WidFactory = window.require('WAWebWidFactory');
          const wid = WidFactory.createWid(id);

          // B: getAlternateUserWid
          const ContactApi = window.require('WAWebApiContact');
          if (ContactApi?.getAlternateUserWid) {
            const alt = ContactApi.getAlternateUserWid(wid);
            if (alt?._serialized) return alt._serialized;
            if (alt?.user) return alt.user;
          }

          // C: Contact Collection
          const ContactCol = window.require('WAWebCollections')?.Contact;
          if (ContactCol) {
            const c = ContactCol.get(wid) || await ContactCol.find(wid);
            if (c?.phoneNumber?._serialized) return c.phoneNumber._serialized;
            if (c?.id && !c.id.isLid()) return c.id._serialized;
          }
        } catch (e) {
          return null;
        }
        return null;
      }, fullId);

      if (res) {
        const p = normalizePhone(res);
        if (p) {
          console.log(`[WA-Service] 🎯 Resuelto vía puppeteer Contact: ${fullId} → +${p}`);
          return p;
        }
      }
    }
  } catch (err) {
    console.warn('[WA-Service] Error evaluando en puppeteer:', err.message);
  }

  return clean;
}

// ─── Guardar mensaje en Supabase ───────────────────────────────────────────
async function saveMessageToSupabase({ phone, name, body, mediaUrl, messageId, senderType = 'customer' }) {
  try {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) return;

    // 1. Obtener la config de WhatsApp del CRM
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('status', 'connected')
      .single();

    if (!config) {
      console.error('[WA-Service] No hay whatsapp_config activa en DB');
      return;
    }

    const accountId = config.account_id;
    const userId = config.user_id;

    // 2. Buscar o crear contacto usando variantes de teléfono
    const variants = getPhoneVariants(cleanPhone);
    let { data: contact } = await supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', accountId)
      .in('phone', variants)
      .limit(1)
      .maybeSingle();

    if (!contact) {
      const displayPhone = `+${cleanPhone}`;
      const displayName = name || displayPhone;
      const { data: newContact, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone: displayPhone,
          name: displayName,
        })
        .select()
        .single();

      if (contactErr) {
        console.error('[WA-Service] Error creando contacto:', contactErr.message);
        return;
      }
      contact = newContact;
      console.log(`[WA-Service] Nuevo contacto creado: ${contact.phone} (${contact.name})`);
    } else if (name && contact.name === contact.phone && name !== contact.phone) {
      await supabase.from('contacts').update({ name }).eq('id', contact.id);
    }

    // 3. Buscar o crear conversación
    let { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: userId,
          contact_id: contact.id,
          status: 'open',
          last_message_at: new Date().toISOString(),
          last_message_text: body?.slice(0, 255) || '',
          unread_count: senderType === 'customer' ? 1 : 0,
        })
        .select()
        .single();

      if (convErr) {
        console.error('[WA-Service] Error creando conversación:', convErr.message);
        return;
      }
      conversation = newConv;
      console.log(`[WA-Service] Nueva conversación: ${conversation.id}`);
    }

    // 4. Insertar mensaje en messages
    const contentText = body || (mediaUrl ? '[Archivo multimedia]' : '');
    const { error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: senderType,
        sender_id: senderType === 'customer' ? contact.id : null,
        content_type: mediaUrl ? 'media' : 'text',
        content_text: contentText,
        media_url: mediaUrl || null,
        status: senderType === 'customer' ? 'delivered' : 'sent',
        message_id: messageId || `wa-${Date.now()}`,
      });

    if (msgErr) {
      console.error('[WA-Service] Error insertando mensaje:', msgErr.message);
      return;
    }

    // 5. Actualizar conversación con último mensaje
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_text: contentText.slice(0, 255),
      })
      .eq('id', conversation.id);

    console.log(`[WA-Service] ✅ Mensaje (${senderType}) guardado en conversación ${conversation.id}`);
  } catch (err) {
    console.error('[WA-Service] Error guardando mensaje en Supabase:', err.message);
  }
}

// ─── WhatsApp Web Client ────────────────────────────────────────────────────
function initWhatsApp() {
  whatsappClient = new Client({
    authStrategy: new LocalAuth({ clientId: 'crm-production' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  whatsappClient.on('qr', (qr) => {
    currentQR = qr;
    status = 'qr';
    console.log('[WA-Service] QR generado → abrí http://localhost:3001 para escanear');
  });

  whatsappClient.on('authenticated', () => {
    status = 'authenticated';
    currentQR = null;
    console.log('[WA-Service] ✅ Autenticado');
  });

  let readyTimestamp = Math.floor(Date.now() / 1000);

  whatsappClient.on('ready', () => {
    status = 'ready';
    readyTimestamp = Math.floor(Date.now() / 1000);
    console.log('[WA-Service] ✅ WhatsApp listo para enviar y recibir mensajes');
  });

  whatsappClient.on('message', async (msg) => {
    if (msg.fromMe) return;
    if (msg.from.includes('@g.us')) return;
    if (msg.timestamp && msg.timestamp < readyTimestamp) return;

    let senderPhone = await resolveRealPhone(msg.author || msg.from);
    let senderName = null;
    try {
      const waContact = await msg.getContact();
      if (waContact?.pushname || waContact?.name) {
        senderName = waContact.pushname || waContact.name;
      }
    } catch (e) {
      console.warn('[WA-Service] getContact error:', e.message);
    }

    let mediaUrl = null;
    let mediaType = null;
    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        mediaType = media.mimetype;
      } catch (e) {
        console.error('[WA-Service] Error descargando media:', e.message);
      }
    }

    console.log(`[WA-Service] Mensaje entrante de +${senderPhone} (${senderName || 'sin nombre'}): "${msg.body?.slice(0, 50)}"`);

    await saveMessageToSupabase({
      phone: senderPhone,
      name: senderName,
      body: msg.body,
      mediaUrl,
      mediaType,
      messageId: msg.id.id,
      senderType: 'customer',
    });
  });

  // Sincronizar mensajes enviados directamente desde la app de WhatsApp del celular
  whatsappClient.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    if (msg.to && msg.to.includes('@g.us')) return;
    if (msg.timestamp && msg.timestamp < readyTimestamp) return;

    if (recentSentIds.has(msg.id.id)) {
      recentSentIds.delete(msg.id.id);
      return;
    }

    let targetPhone = await resolveRealPhone(msg.to);
    let targetName = null;
    try {
      const waContact = await msg.getContact();
      if (waContact?.pushname || waContact?.name) targetName = waContact.pushname || waContact.name;
    } catch {}

    await saveMessageToSupabase({
      phone: targetPhone,
      name: targetName,
      body: msg.body,
      messageId: msg.id.id,
      senderType: 'agent',
    });
  });

  whatsappClient.on('disconnected', (reason) => {
    status = 'initializing';
    console.log('[WA-Service] Desconectado:', reason, '— reconectando...');
    setTimeout(() => initWhatsApp(), 5000);
  });

  whatsappClient.on('auth_failure', (msg) => {
    status = 'error';
    console.error('[WA-Service] Error de autenticación:', msg);
  });

  whatsappClient.initialize();
}

// ─── HTTP Server (API para el CRM) ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS para Next.js en localhost:3000
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /status — estado de la conexión
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const realPhone = whatsappClient?.info?.wid?.user ? `+${whatsappClient.info.wid.user}` : CRM_PHONE;
    res.end(JSON.stringify({ status, phone: realPhone, info: whatsappClient?.info || null }));
    return;
  }

  // GET /resolve?id=... — probar resolución de LID a teléfono
  if (req.method === 'GET' && url.pathname === '/resolve') {
    const id = url.searchParams.get('id');
    const resolved = await resolveRealPhone(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, resolved, phone: `+${resolved}` }));
    return;
  }

  // GET /qr — página con el QR para escanear
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    const qrImg = currentQR
      ? await qrcode.toDataURL(currentQR, { width: 280, margin: 2 })
      : null;

    res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>WhatsApp CRM</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff}
    .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:48px;text-align:center;max-width:420px;width:90%;box-shadow:0 25px 50px rgba(0,0,0,.5)}
    h1{font-size:22px;margin-bottom:8px}
    p{color:#94a3b8;font-size:14px;margin-bottom:24px;line-height:1.6}
    .qr{background:#fff;border-radius:16px;padding:16px;display:inline-block;margin-bottom:24px}
    .ready{background:rgba(37,211,102,.15);border:1px solid #25d366;border-radius:12px;padding:24px;color:#25d366;font-size:18px;font-weight:700}
    .waiting{color:#94a3b8;padding:32px}
    .spinner{border:3px solid rgba(255,255,255,.1);border-top:3px solid #25d366;border-radius:50%;width:36px;height:36px;animation:spin 1s linear infinite;margin:0 auto 16px}
    @keyframes spin{to{transform:rotate(360deg)}}
    .steps{text-align:left;background:rgba(255,255,255,.05);border-radius:12px;padding:16px;margin-top:8px}
    .step{display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13px;color:#cbd5e1}
    .n{background:#25d366;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0}
  </style>
  <script>setInterval(async()=>{const r=await fetch('/status');const d=await r.json();if(d.status==='ready'||d.status==='qr')location.reload();},3000)</script>
</head>
<body><div class="card">
  <div style="font-size:44px;margin-bottom:12px">💬</div>
  <h1>WhatsApp CRM</h1>
  ${status === 'ready'
    ? `<div class="ready">✅ Conectado<br><span style="font-size:13px;font-weight:400;color:#86efac;margin-top:6px;display:block">${CRM_PHONE}</span></div>`
    : status === 'qr' && qrImg
      ? `<p>Escaneá con tu celular para conectar <strong>${CRM_PHONE}</strong></p>
         <div class="qr"><img src="${qrImg}" width="248" height="248"/></div>
         <div class="steps">
           <div class="step"><span class="n">1</span>Abrí WhatsApp en tu celular</div>
           <div class="step"><span class="n">2</span>Tocá ⋮ → Dispositivos vinculados</div>
           <div class="step"><span class="n">3</span>Tocá "Vincular dispositivo"</div>
           <div class="step"><span class="n">4</span>Apuntá la cámara aquí</div>
         </div>`
      : `<div class="waiting"><div class="spinner"></div>Iniciando...</div>`
  }
</div></body></html>`);
    return;
  }

  // POST /send — enviar mensaje desde el CRM
  if (req.method === 'POST' && url.pathname === '/send') {
    if (status !== 'ready') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'WhatsApp no conectado', status }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { to, message, mediaUrl, fromCrm } = JSON.parse(body);
        if (!to || (!message && !mediaUrl)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Faltan parámetros: to, message' }));
          return;
        }

        // Resolver el ID real del número (necesario para multi-device WhatsApp)
        const digits = normalizePhone(to);
        const numberId = await whatsappClient.getNumberId(digits);
        if (!numberId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `El número ${to} no tiene WhatsApp activo` }));
          return;
        }
        const chatId = numberId._serialized;
        let msgResult;

        if (mediaUrl) {
          const media = await MessageMedia.fromUrl(mediaUrl);
          msgResult = await whatsappClient.sendMessage(chatId, media, { caption: message || '' });
        } else {
          msgResult = await whatsappClient.sendMessage(chatId, message);
        }

        const messageId = msgResult?.id?.id || msgResult?.id?._serialized || `wa-out-${Date.now()}`;
        if (msgResult?.id?.id) recentSentIds.add(msgResult.id.id);

        // Si no fue enviado desde la API del CRM (que ya guarda en DB), guardarlo aquí
        if (!fromCrm) {
          await saveMessageToSupabase({
            phone: digits,
            body: message,
            mediaUrl,
            messageId,
            senderType: 'agent',
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, messageId }));
        console.log(`[WA-Service] ✅ Mensaje enviado a ${to}`);

      } catch (err) {
        console.error('[WA-Service] Error enviando:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🚀 WhatsApp Service corriendo en http://localhost:${PORT}`);
  console.log(`📱 Número del CRM: ${CRM_PHONE}`);
  console.log(`🌐 Para escanear el QR: http://localhost:${PORT}\n`);
  initWhatsApp();
});
