/**
 * WhatsApp Web Sidecar Service — Multi-Tenant SaaS Edition
 *
 * Maneja múltiples sesiones de WhatsApp Web simultáneas, una por account_id.
 * Corre en puerto 3001 junto al CRM (Next.js en puerto 3000).
 *
 * API REST:
 *   GET  /                             → dashboard HTML con tabla de sesiones
 *   GET  /status                        → estado global del servicio (JSON)
 *   GET  /sessions                      → lista de todas las sesiones (JSON)
 *   GET  /sessions/:accountId/status    → estado de una sesión específica
 *   GET  /sessions/:accountId/qr        → página HTML para escanear QR
 *   POST /sessions/:accountId/start     → iniciar sesión de una cuenta
 *   POST /sessions/:accountId/stop      → desconectar una cuenta
 *   POST /sessions/:accountId/send      → enviar mensaje (desde el CRM)
 *
 * Uso: node whatsapp-service.mjs
 */

import http from 'http';
import crypto from 'crypto';
import dotenv from 'dotenv';
import qrcode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import pkg from 'whatsapp-web.js';

dotenv.config({ path: '.env.local' });

const { Client, LocalAuth, MessageMedia } = pkg;

// ─── Config global ──────────────────────────────────────────────────────────
const PORT = process.env.WA_SERVICE_PORT || 3001;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ENCRYPTION_KEY) {
  console.error('[WA-Service] FATAL: Faltan variables de entorno requeridas.');
  console.error('  Requeridas: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY');
  process.exit(1);
}

globalThis.WebSocket = class {};
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Session Manager ──────────────────────────────────────────────────────────
/**
 * Mapa central: accountId → SessionState
 * Cada cuenta tiene su propio estado, cliente Puppeteer, y conjuntos de IDs.
 */
const sessions = new Map();

function createSessionState(accountId) {
  return {
    accountId,
    client: null,
    status: 'initializing', // initializing | qr | authenticated | ready | error | stopped
    qr: null,
    phone: null,
    readyTimestamp: Math.floor(Date.now() / 1000) - 120,
    isRestarting: false,
    recentSentIds: new Set(),
    recentProcessedIds: new Set(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function decryptKey(encryptedText) {
  if (!encryptedText) return null;
  try {
    const parts = encryptedText.split(':');
    if (parts.length === 3) {
      const [ivHex, ctHex, tagHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(tagHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(ctHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    if (parts.length === 2) {
      const [ivHex, ctHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
      let decrypted = decipher.update(ctHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    return encryptedText;
  } catch (err) {
    console.error(`[WA] Error desencriptando clave:`, err.message);
    return null;
  }
}

function log(accountId, msg) {
  const tag = accountId ? `[WA][${accountId.slice(0, 8)}]` : '[WA-Service]';
  console.log(`${tag} ${msg}`);
}

// ─── Resolver LID → teléfono real ────────────────────────────────────────────
async function resolveRealPhone(session, waId) {
  if (!waId) return '';
  const clean = normalizePhone(waId);
  const { client } = session;

  if ((waId.endsWith('@c.us') || !waId.includes('@')) && clean.length >= 10 && clean.length <= 13) {
    return clean;
  }

  const fullId = waId.includes('@') ? waId : `${clean}@lid`;

  try {
    if (client && typeof client.getContactLidAndPhone === 'function') {
      const res = await client.getContactLidAndPhone(fullId);
      if (Array.isArray(res) && res[0]?.pn) {
        const p = normalizePhone(res[0].pn);
        if (p) return p;
      }
    }
  } catch {}

  try {
    if (client?.pupPage) {
      const res = await client.pupPage.evaluate(async (id) => {
        try {
          if (window.WWebJS?.enforceLidAndPnRetrieval) {
            const pair = await window.WWebJS.enforceLidAndPnRetrieval(id);
            if (pair?.phone?._serialized) return pair.phone._serialized;
          }
          const WidFactory = window.require('WAWebWidFactory');
          const wid = WidFactory.createWid(id);
          const ContactApi = window.require('WAWebApiContact');
          if (ContactApi?.getAlternateUserWid) {
            const alt = ContactApi.getAlternateUserWid(wid);
            if (alt?._serialized) return alt._serialized;
            if (alt?.user) return alt.user;
          }
          const ContactCol = window.require('WAWebCollections')?.Contact;
          if (ContactCol) {
            const c = ContactCol.get(wid) || await ContactCol.find(wid);
            if (c?.phoneNumber?._serialized) return c.phoneNumber._serialized;
            if (c?.id && !c.id.isLid()) return c.id._serialized;
          }
        } catch { return null; }
        return null;
      }, fullId);
      if (res) {
        const p = normalizePhone(res);
        if (p) return p;
      }
    }
  } catch {}

  return clean;
}

// ─── Auto-Reply de IA (por sesión) ───────────────────────────────────────────
async function handleAiAutoReply(session, { conversationId, contactPhone }) {
  const { accountId, client } = session;
  try {
    const { data: config } = await supabase
      .from('ai_configs')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .maybeSingle();

    if (!config || !config.auto_reply_enabled) return;

    // Verificar si el plan de la cuenta permite IA auto-reply y tiene cupo de mensajes
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, messages_used_this_month, plans(feature_ai_reply, max_messages_per_month)')
      .eq('account_id', accountId)
      .maybeSingle();

    if (sub && sub.plans) {
      if (sub.plans.feature_ai_reply === false) {
        log(accountId, '⚠️ IA auto-reply no habilitado en el plan de esta cuenta (requiere plan Starter o Pro)');
        return;
      }
      if (sub.plans.max_messages_per_month < 900000 && (sub.messages_used_this_month || 0) >= sub.plans.max_messages_per_month) {
        log(accountId, '⚠️ Límite mensual de mensajes alcanzado en el plan de esta cuenta');
        return;
      }
    }

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle();

    if (!conv || conv.assigned_agent_id) return;

    if (conv.ai_autoreply_disabled) {
      await supabase.from('conversations')
        .update({ ai_autoreply_disabled: false, ai_handoff_summary: null })
        .eq('id', conversationId);
    }

    const { data: rawMsgs } = await supabase
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(12);

    const recentMsgs = rawMsgs ? rawMsgs.reverse() : [];
    const messages = [];
    if (config.system_prompt) messages.push({ role: 'system', content: config.system_prompt });

    let lastRole = null, lastText = null;
    for (const m of recentMsgs) {
      if (!m.content_text) continue;
      const role = m.sender_type === 'customer' ? 'user' : 'assistant';
      const trimmed = m.content_text.trim();
      if (role === lastRole && trimmed === lastText) continue;
      messages.push({ role, content: trimmed });
      lastRole = role; lastText = trimmed;
    }

    while (messages.length > 1 && messages[messages.length - 1].role === 'assistant') messages.pop();
    if (messages.filter(m => m.role === 'user').length === 0) return;

    const apiKey = decryptKey(config.api_key);
    if (!apiKey) return;

    const modelName = config.model || 'llama-3.1-8b-instant';
    log(accountId, `🧠 IA con ${config.provider} (${modelName})...`);

    let replyText = '';
    try {
      if (config.provider === 'groq') {
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelName, messages, max_tokens: 250, temperature: 0.6 }),
        });
        if (resp.ok) replyText = (await resp.json()).choices?.[0]?.message?.content?.trim() || '';
      } else if (config.provider === 'openai') {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelName, messages, max_tokens: 450, temperature: 0.7 }),
        });
        if (resp.ok) replyText = (await resp.json()).choices?.[0]?.message?.content?.trim() || '';
      } else if (config.provider === 'anthropic') {
        const systemMsg = messages.find(m => m.role === 'system')?.content || '';
        const chatMsgs = messages.filter(m => m.role !== 'system');
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: modelName, system: systemMsg, messages: chatMsgs, max_tokens: 450 }),
        });
        if (resp.ok) replyText = (await resp.json()).content?.[0]?.text?.trim() || '';
      }
    } catch (err) {
      console.error(`[WA][${accountId.slice(0, 8)}] Error llamando a IA:`, err.message);
    }

    if (!replyText) {
      replyText = 'Para brindarte una información más acertada, una persona especializada se pondrá en contacto contigo por este mismo chat a la brevedad. 😊';
    }

    log(accountId, `💬 "${replyText.slice(0, 60)}..."`);

    const digits = normalizePhone(contactPhone);
    let chatId = `${digits}@c.us`;
    try {
      const numberId = await client.getNumberId(digits);
      if (numberId?._serialized) chatId = numberId._serialized;
    } catch {}

    const msgResult = await client.sendMessage(chatId, replyText);
    if (msgResult?.id?.id) session.recentSentIds.add(msgResult.id.id);
    if (msgResult?.id?._serialized) session.recentSentIds.add(msgResult.id._serialized);

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: replyText,
      status: 'sent',
      ai_generated: true,
    });

    await supabase.from('conversations').update({
      last_message_text: replyText,
      last_message_at: new Date().toISOString(),
      ai_reply_count: (conv.ai_reply_count || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', conversationId);

    // Incrementar contador de mensajes usados en el mes para el SaaS
    if (sub?.id) {
      await supabase
        .from('subscriptions')
        .update({
          messages_used_this_month: (sub.messages_used_this_month || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id);
    }

    log(accountId, `✅ Auto-reply enviado a +${digits}`);
  } catch (err) {
    console.error(`[WA][${accountId.slice(0, 8)}] Error en auto-reply:`, err.message);
  }
}

// ─── Guardar mensaje en Supabase (por sesión) ─────────────────────────────────
async function saveMessage(session, { phone, name, body, mediaUrl, messageId, senderType = 'customer', avatarUrl = null, createdAt = null }) {
  const { accountId } = session;
  try {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length > 15) return null;
    if (phone?.includes('@g.us') || phone?.includes('broadcast')) return null;

    // Obtener user_id del owner de la cuenta para asignarlo en nuevas filas
    const { data: waConfig } = await supabase
      .from('whatsapp_config')
      .select('user_id')
      .eq('account_id', accountId)
      .maybeSingle();
    let userId = waConfig?.user_id || null;

    if (!userId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .limit(1)
        .maybeSingle();
      userId = prof?.user_id || null;
    }

    // Buscar o crear contacto
    const variants = getPhoneVariants(cleanPhone);
    let { data: contact } = await supabase
      .from('contacts')
      .select('id, name, phone, avatar_url')
      .eq('account_id', accountId)
      .in('phone', variants)
      .limit(1)
      .maybeSingle();

    if (!contact) {
      const { data: newContact, error } = await supabase
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: userId,
          phone: `+${cleanPhone}`,
          name: name || `+${cleanPhone}`,
          avatar_url: avatarUrl || null,
        })
        .select()
        .single();
      if (error) { console.error(`[WA][${accountId.slice(0, 8)}] Error contacto:`, error.message); return null; }
      contact = newContact;
      log(accountId, `Nuevo contacto: ${contact.phone}${avatarUrl ? ' (con foto)' : ''}`);
    } else {
      const updates = {};
      if (name && (contact.name === contact.phone || !contact.name) && name !== contact.phone) {
        updates.name = name;
      }
      if (avatarUrl && (!contact.avatar_url || contact.avatar_url !== avatarUrl)) {
        updates.avatar_url = avatarUrl;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('contacts').update(updates).eq('id', contact.id);
      }
    }

    // Buscar o crear conversación
    const timestamp = createdAt || new Date().toISOString();
    let { data: conversation } = await supabase
      .from('conversations')
      .select('id, last_message_at')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error } = await supabase
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: userId,
          contact_id: contact.id,
          status: 'open',
          last_message_at: timestamp,
          last_message_text: body?.slice(0, 255) || '',
          unread_count: senderType === 'customer' ? 1 : 0,
        })
        .select()
        .single();
      if (error) { console.error(`[WA][${accountId.slice(0, 8)}] Error conversación:`, error.message); return null; }
      conversation = newConv;
      log(accountId, `Nueva conversación: ${conversation.id}`);
    }

    // Deduplicación: no insertar si el message_id ya existe
    const finalMsgId = messageId || `wa-${Date.now()}`;
    if (messageId) {
      const { data: existingMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversation.id)
        .eq('message_id', finalMsgId)
        .maybeSingle();
      if (existingMsg) {
        return { contact, conversation, alreadyExists: true };
      }
    }

    // Insertar mensaje
    const contentText = body || (mediaUrl ? '[Archivo multimedia]' : '');
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: senderType,
      sender_id: senderType === 'customer' ? contact.id : null,
      content_type: mediaUrl ? 'media' : 'text',
      content_text: contentText,
      media_url: mediaUrl || null,
      status: senderType === 'customer' ? 'delivered' : 'sent',
      message_id: finalMsgId,
      created_at: timestamp,
    });
    if (msgErr) { console.error(`[WA][${accountId.slice(0, 8)}] Error mensaje:`, msgErr.message); return null; }

    // Actualizar last_message_at sólo si este mensaje es más reciente
    if (!conversation.last_message_at || new Date(timestamp) >= new Date(conversation.last_message_at)) {
      await supabase.from('conversations').update({
        last_message_at: timestamp,
        last_message_text: contentText.slice(0, 255),
      }).eq('id', conversation.id);
    }

    log(accountId, `✅ Mensaje (${senderType}) en conv ${conversation.id}`);
    return { contact, conversation };
  } catch (err) {
    console.error(`[WA][${accountId.slice(0, 8)}] Error guardando mensaje:`, err.message);
    return null;
  }
}

// ─── Sincronizar chats recientes y fotos de perfil ───────────────────────────
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function syncRecentChats(session, maxChats = 50, msgsPerChat = 50) {
  const { accountId, client } = session;
  if (!client) return { syncedChats: 0, syncedMessages: 0 };
  log(accountId, `🔄 Iniciando sincronización de ${maxChats} chats recientes con historial y fotos...`);

  // whatsapp-web.js puede rechazar getChats() si el cliente aún no está
  // completamente listo internamente. Reintentar hasta 3 veces.
  let chats = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sleep(attempt === 1 ? 3000 : 5000);
      chats = await client.getChats();
      break;
    } catch (e) {
      console.error(`[WA][${accountId.slice(0, 8)}] getChats intento ${attempt}/3 fallido:`, e?.message || e);
      if (attempt === 3) return { error: `getChats falló después de 3 intentos: ${e?.message || e}` };
    }
  }

  try {
    log(accountId, `Total chats en WhatsApp: ${chats.length}`);

    const eligibleChats = chats
      .filter(c => !c.id?._serialized?.includes('status@broadcast') && !c.isGroup)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, maxChats);

    let totalSyncedChats = 0;
    let totalSyncedMsgs = 0;

    for (const chat of eligibleChats) {
      try {
        const rawPhone = chat.id?.user || chat.id?._serialized?.split('@')[0];
        const phone = normalizePhone(rawPhone);
        if (!phone) continue;

        // Nombre del contacto
        let name = chat.name || chat.formattedTitle;
        if (!name || name === rawPhone || name === phone) {
          try {
            const c = await chat.getContact();
            name = c?.pushname || c?.name || null;
          } catch {}
        }
        if (!name) name = `+${phone}`;

        // Foto de perfil del contacto
        let avatarUrl = null;
        try {
          avatarUrl = await client.getProfilePicUrl(chat.id._serialized);
        } catch {}

        // Mensajes históricos del chat
        let messages = [];
        try {
          messages = await chat.fetchMessages({ limit: msgsPerChat });
        } catch {}

        if ((!messages || messages.length === 0) && chat.lastMessage) {
          messages = [chat.lastMessage];
        }

        if (messages && messages.length > 0) {
          messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

          for (const msg of messages) {
            if (!msg.body && !msg.hasMedia) continue;
            const senderType = msg.fromMe ? 'agent' : 'customer';
            const msgBody = msg.body || (msg.hasMedia ? `[${msg.type || 'Archivo multimedia'}]` : '');
            const msgTimestamp = msg.timestamp
              ? new Date(msg.timestamp * 1000).toISOString()
              : new Date().toISOString();
            const msgId = msg.id?.id || msg.id?._serialized || `wa-hist-${msg.timestamp}-${phone}`;

            const res = await saveMessage(session, {
              phone,
              name,
              body: msgBody,
              mediaUrl: null,
              messageId: msgId,
              senderType,
              avatarUrl,
              createdAt: msgTimestamp,
            });

            if (res && !res.alreadyExists) totalSyncedMsgs++;
          }
        } else {
          // Si no hay mensajes, al menos creamos el contacto con foto
          await saveMessage(session, {
            phone,
            name,
            body: '',
            messageId: null,
            senderType: 'customer',
            avatarUrl,
            createdAt: new Date().toISOString(),
          });
        }

        totalSyncedChats++;
      } catch (chatError) {
        console.error(`[WA][${accountId.slice(0, 8)}] Error en chat individual:`, chatError.message);
      }
    }

    log(accountId, `✅ Sync completado: ${totalSyncedChats} contactos, ${totalSyncedMsgs} mensajes nuevos.`);
    return { syncedChats: totalSyncedChats, syncedMessages: totalSyncedMsgs };
  } catch (err) {
    console.error(`[WA][${accountId.slice(0, 8)}] Error general en syncRecentChats:`, err.message);
    return { error: err.message };
  }
}

// ─── Polling de respaldo ───────────────────────────────────────────────────────
async function checkUnreadChats(session) {
  if (!session.client?.pupPage) return;
  try {
    const items = await session.client.pupPage.evaluate(() => {
      try {
        const { Chat } = window.require('WAWebCollections');
        const chats = Chat.getModelsArray ? Chat.getModelsArray() : [];
        return chats.slice(0, 15)
          .filter(c => !c.id?._serialized?.includes('@g.us'))
          .map(c => {
            const msgs = c.msgs?.getModelsArray?.() || [];
            const last = msgs[msgs.length - 1];
            if (!last || last.id?.fromMe) return null;
            return { chatId: c.id?._serialized, name: c.name || '', body: last.body || '', messageId: last.id?._serialized || last.id?.id || '', timestamp: last.t };
          })
          .filter(Boolean);
      } catch { return []; }
    });

    for (const item of (items || [])) {
      if (!item.messageId || session.recentProcessedIds.has(item.messageId)) continue;
      if (item.chatId?.includes('@g.us')) continue;
      if (item.timestamp && item.timestamp < session.readyTimestamp) continue;

      const { data: exists } = await supabase.from('messages').select('id').eq('message_id', item.messageId).maybeSingle();
      if (exists) { session.recentProcessedIds.add(item.messageId); continue; }

      session.recentProcessedIds.add(item.messageId);
      const phone = await resolveRealPhone(session, item.chatId);
      log(session.accountId, `📬 Detectado de +${phone}: "${item.body?.slice(0, 40)}"`);

      const result = await saveMessage(session, { phone, name: item.name, body: item.body, messageId: item.messageId });
      if (result) {
        handleAiAutoReply(session, { conversationId: result.conversation.id, contactPhone: phone }).catch(() => {});
      }
    }
  } catch (err) {
    if (err.message?.match(/detached Frame|Session closed|Target closed/)) {
      restartSession(session, err.message);
    }
  }
}

// ─── Cerrar modales emergentes de WhatsApp Web ────────────────────────────────
function startModalDismisser(session) {
  setInterval(async () => {
    try {
      if (session.client?.pupPage) {
        await session.client.pupPage.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return;
          const btn = dialog.querySelector('[aria-label="Close"]') ||
                      dialog.querySelector('[data-icon="x"]')?.closest('button') ||
                      dialog.querySelector('button[aria-label="Cerrar"]') ||
                      dialog.querySelector('button');
          if (btn) btn.click();
        });
      }
    } catch {}
  }, 3000);
}

// ─── Iniciar sesión para una cuenta ───────────────────────────────────────────
function initSession(accountId) {
  // Si ya hay una sesión corriendo o en proceso, no duplicar
  if (sessions.has(accountId)) {
    const existing = sessions.get(accountId);
    if (existing.status === 'ready') {
      log(accountId, 'Sesión ya está lista, omitiendo init');
      return existing;
    }
    if (existing.status === 'initializing' || existing.status === 'qr') {
      log(accountId, `Sesión ya en proceso (${existing.status}), omitiendo duplicado`);
      return existing;
    }
    // Si estaba en estado previo (error, stopped), limpiamos antes de recrear
    if (existing.client) {
      try { existing.client.destroy().catch(() => {}); } catch {}
      existing.client = null;
    }
  }

  const session = createSessionState(accountId);
  sessions.set(accountId, session);
  log(accountId, '🚀 Iniciando sesión...');

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `saas-${accountId}` }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1023054178-alpha.html',
    },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,800',
      ],
    },
  });
  session.client = client;

  client.on('qr', (qr) => {
    session.qr = qr;
    session.status = 'qr';
    log(accountId, `QR listo → GET /sessions/${accountId}/qr`);
    supabase.from('whatsapp_config').update({ status: 'qr', updated_at: new Date().toISOString() }).eq('account_id', accountId).then(() => {});
  });

  client.on('authenticated', () => {
    session.status = 'authenticated';
    session.qr = null;
    log(accountId, '✅ Autenticado');

    // Arrancar modal-dismisser ANTES del ready para desbloquear pantallas intermedias
    startModalDismisser(session);

    // Watchdog: si no llegamos a 'ready' en 90s, reiniciar sesión
    const watchdog = setTimeout(() => {
      if (session.status !== 'ready') {
        log(accountId, '⚠️ Watchdog: sesión atascada en authenticated, reiniciando...');
        restartSession(session, 'watchdog_stuck_authenticated');
      }
    }, 90_000);
    session._authWatchdog = watchdog;
  });

  client.on('ready', async () => {
    session.status = 'ready';
    session.readyTimestamp = Math.floor(Date.now() / 1000) - 120;
    session.phone = client.info?.wid?.user ? `+${client.info.wid.user}` : null;
    log(accountId, `✅ Listo — Teléfono: ${session.phone}`);

    try {
      const { data: existing } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('account_id', accountId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('whatsapp_config')
          .update({
            status: 'connected',
            phone_number_id: session.phone || 'whatsapp_web',
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId);
      } else {
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', accountId)
          .limit(1)
          .maybeSingle();

        await supabase
          .from('whatsapp_config')
          .insert({
            account_id: accountId,
            user_id: profile?.user_id,
            phone_number_id: session.phone || 'whatsapp_web',
            waba_id: 'whatsapp_web',
            access_token: 'whatsapp_web_session',
            verify_token: 'whatsapp_web_session',
            status: 'connected',
            updated_at: new Date().toISOString(),
          });
      }
    } catch (e) {
      console.error(`[WA][${accountId.slice(0, 8)}] Error guardando estado en whatsapp_config:`, e.message);
    }

    // Limpiar watchdog ya que llegamos a ready
    if (session._authWatchdog) { clearTimeout(session._authWatchdog); session._authWatchdog = null; }

    setInterval(() => checkUnreadChats(session), 2500);
    // El modal-dismisser ya fue iniciado en 'authenticated', no duplicar

    // Sincronizar historial y fotos 5 segundos tras conectar
    setTimeout(() => {
      syncRecentChats(session).catch(e =>
        console.error(`[WA][${accountId.slice(0, 8)}] Error en sync automático:`, e.message)
      );
    }, 5000);
  });

  client.on('message', async (msg) => {
    if (msg.fromMe || msg.from.includes('@g.us') || msg.from === 'status@broadcast') return;
    if (msg.timestamp && msg.timestamp < session.readyTimestamp) return;
    if (msg.id?.id) {
      if (session.recentProcessedIds.has(msg.id.id)) return;
      session.recentProcessedIds.add(msg.id.id);
    }

    const phone = await resolveRealPhone(session, msg.author || msg.from);
    let name = null;
    try { const c = await msg.getContact(); name = c?.pushname || c?.name || null; } catch {}

    let mediaUrl = null;
    if (msg.hasMedia) { try { await msg.downloadMedia(); } catch {} }

    log(accountId, `📨 De +${phone}: "${msg.body?.slice(0, 50)}"`);
    const result = await saveMessage(session, { phone, name, body: msg.body, mediaUrl, messageId: msg.id.id });
    if (result) {
      handleAiAutoReply(session, { conversationId: result.conversation.id, contactPhone: phone }).catch(() => {});
    }
  });

  client.on('message_create', async (msg) => {
    if (!msg.fromMe || msg.to?.includes('@g.us') || msg.to === 'status@broadcast') return;
    if (msg.timestamp && msg.timestamp < session.readyTimestamp) return;
    if (session.recentSentIds.has(msg.id.id)) { session.recentSentIds.delete(msg.id.id); return; }

    const phone = await resolveRealPhone(session, msg.to);
    let name = null;
    try { const c = await msg.getContact(); name = c?.pushname || c?.name || null; } catch {}
    await saveMessage(session, { phone, name, body: msg.body, messageId: msg.id.id, senderType: 'agent' });
  });

  client.on('disconnected', (reason) => {
    log(accountId, `⚠️ Desconectado: ${reason}`);
    supabase.from('whatsapp_config').update({ status: 'disconnected', updated_at: new Date().toISOString() }).eq('account_id', accountId).then(() => {});
    restartSession(session, reason);
  });

  client.on('auth_failure', (msg) => {
    session.status = 'error';
    console.error(`[WA][${accountId.slice(0, 8)}] Error de autenticación:`, msg);
  });

  client.initialize();
  return session;
}

async function restartSession(session, reason) {
  if (session.isRestarting) return;
  session.isRestarting = true;
  log(session.accountId, `🔄 Reiniciando (${reason})...`);
  try { if (session.client) await session.client.destroy().catch(() => {}); } catch {}
  session.client = null;
  session.status = 'initializing';
  setTimeout(() => {
    session.isRestarting = false;
    initSession(session.accountId);
  }, 5000);
}

async function stopSession(accountId) {
  const session = sessions.get(accountId);
  if (!session) return false;
  try { if (session.client) await session.client.destroy().catch(() => {}); } catch {}
  session.status = 'stopped';
  session.client = null;
  sessions.delete(accountId);
  log(accountId, '⏹ Sesión detenida');
  return true;
}

// ─── Carga inicial: sesiones de todas las cuentas activas ─────────────────────
async function loadAllSessions() {
  log(null, 'Cargando sesiones activas desde Supabase...');
  const { data: configs, error } = await supabase
    .from('whatsapp_config')
    .select('account_id, status')
    .in('status', ['connected', 'qr', 'authenticated']);

  if (error) { console.error('[WA-Service] Error:', error.message); return; }
  if (!configs?.length) { log(null, 'Sin sesiones activas — esperando activaciones vía POST /sessions/:accountId/start'); return; }

  log(null, `Iniciando ${configs.length} sesión(es)...`);
  for (const cfg of configs) {
    initSession(cfg.account_id);
    await new Promise(r => setTimeout(r, 3000)); // espaciar inicializaciones
  }
}

// ─── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS — permitir llamadas desde el CRM (Next.js) y cualquier origen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const html = (content, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  };

  // ── GET /status ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/status') {
    return json({
      service: 'running',
      version: 'saas-multitenant',
      sessions: sessions.size,
      accounts: [...sessions.entries()].map(([id, s]) => ({ accountId: id, status: s.status, phone: s.phone })),
    });
  }

  // ── GET /sessions ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/sessions') {
    return json([...sessions.entries()].map(([id, s]) => ({ accountId: id, status: s.status, phone: s.phone })));
  }

  // ── Rutas /sessions/:accountId/* ───────────────────────────────────────────
  const m = url.pathname.match(/^\/sessions\/([^/]+)(\/.*)?$/);
  if (m) {
    const accountId = m[1];
    const sub = m[2] || '/status';
    const session = sessions.get(accountId);

    // GET /sessions/:accountId/status
    if (req.method === 'GET' && sub === '/status') {
      if (!session) return json({ accountId, status: 'disconnected', qr: null, phone: null });
      return json({
        accountId,
        status: session.status,
        phone: session.phone || null,
        qr: session.qr || null,
      });
    }

    // GET /sessions/:accountId/qr-data
    if (req.method === 'GET' && sub === '/qr-data') {
      return json({
        accountId,
        status: session?.status || 'disconnected',
        qr: session?.qr || null,
        phone: session?.phone || null,
      });
    }

    // GET /sessions/:accountId/qr — página HTML con QR
    if (req.method === 'GET' && sub === '/qr') {
      const isReady = session?.status === 'ready' || session?.status === 'authenticated';
      const hasQr = session?.status === 'qr' && session?.qr;
      const qrImg = hasQr ? await qrcode.toDataURL(session.qr, { width: 280, margin: 2 }) : null;

      return html(`<!DOCTYPE html>
<html lang="es"><head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Conectar WhatsApp</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff}
    .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:48px;text-align:center;max-width:420px;width:90%;box-shadow:0 25px 50px rgba(0,0,0,.5)}
    h1{font-size:22px;margin-bottom:8px}p{color:#94a3b8;font-size:14px;margin-bottom:24px;line-height:1.6}
    .qr{background:#fff;border-radius:16px;padding:16px;display:inline-block;margin-bottom:24px}
    .ready{background:rgba(37,211,102,.15);border:1px solid #25d366;border-radius:12px;padding:24px;color:#25d366;font-size:18px;font-weight:700}
    .waiting{color:#94a3b8;padding:32px}
    .spinner{border:3px solid rgba(255,255,255,.1);border-top:3px solid #25d366;border-radius:50%;width:36px;height:36px;animation:spin 1s linear infinite;margin:0 auto 16px}
    @keyframes spin{to{transform:rotate(360deg)}}
    .steps{text-align:left;background:rgba(255,255,255,.05);border-radius:12px;padding:16px;margin-top:8px}
    .step{display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13px;color:#cbd5e1}
    .n{background:#25d366;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0}
  </style>
  <script>setInterval(async()=>{const r=await fetch('/sessions/${accountId}/status');const d=await r.json();if(['ready','qr'].includes(d.status))location.reload();},3000)</script>
</head><body><div class="card">
  <div style="font-size:44px;margin-bottom:12px">💬</div>
  <h1>Conectar WhatsApp</h1>
  ${isReady
    ? `<div class="ready">✅ Conectado<br><span style="font-size:13px;font-weight:400;color:#86efac;margin-top:6px;display:block">${session.phone || ''}</span></div>`
    : hasQr
      ? `<p>Escaneá con tu celular para conectar esta cuenta</p>
         <div class="qr"><img src="${qrImg}" width="248" height="248"/></div>
         <div class="steps">
           <div class="step"><span class="n">1</span>Abrí WhatsApp en tu celular</div>
           <div class="step"><span class="n">2</span>Tocá ⋮ → Dispositivos vinculados</div>
           <div class="step"><span class="n">3</span>Tocá "Vincular dispositivo"</div>
           <div class="step"><span class="n">4</span>Apuntá la cámara al QR</div>
         </div>`
      : `<div class="waiting"><div class="spinner"></div>Iniciando... (${session?.status || 'no iniciado'})</div>`
  }
</div></body></html>`);
    }

    // POST /sessions/:accountId/start
    if (req.method === 'POST' && sub === '/start') {
      if (session?.status === 'ready') {
        return json({ accountId, status: 'ready', phone: session.phone });
      }
      if (session?.status === 'qr' && session.qr) {
        return json({ accountId, status: 'qr', qr: session.qr, qrUrl: `/sessions/${accountId}/qr` });
      }
      if (session?.status === 'initializing') {
        return json({ accountId, status: 'initializing', qrUrl: `/sessions/${accountId}/qr` });
      }
      initSession(accountId);
      return json({ accountId, status: 'initializing', qrUrl: `/sessions/${accountId}/qr` });
    }

    // POST /sessions/:accountId/restart
    if (req.method === 'POST' && sub === '/restart') {
      await stopSession(accountId);
      initSession(accountId);
      return json({ accountId, status: 'initializing', qrUrl: `/sessions/${accountId}/qr` });
    }

    // POST /sessions/:accountId/sync — sincronizar chats recientes y fotos
    if (req.method === 'POST' && sub === '/sync') {
      const isConn = session?.status === 'ready' || session?.status === 'authenticated';
      if (!isConn) {
        return json({ error: 'WhatsApp no está conectado todavía', status: session?.status || 'disconnected' }, 400);
      }
      const body = await new Promise(resolve => {
        let raw = '';
        req.on('data', c => raw += c);
        req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      });
      const maxChats = body.maxChats || 50;
      const msgsPerChat = body.msgsPerChat || 50;
      const result = await syncRecentChats(session, maxChats, msgsPerChat);
      return json({ accountId, ...result });
    }

    // POST /sessions/:accountId/stop
    if (req.method === 'POST' && sub === '/stop') {
      return json({ accountId, stopped: await stopSession(accountId) });
    }

    // POST /sessions/:accountId/send
    if (req.method === 'POST' && sub === '/send') {
      const isConn = session?.status === 'ready' || session?.status === 'authenticated';
      if (!isConn) return json({ error: 'WhatsApp no conectado', accountId, status: session?.status || 'not_started' }, 503);

      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { to, message, mediaUrl, fromCrm } = JSON.parse(body);
          if (!to || (!message && !mediaUrl)) return json({ error: 'Faltan parámetros: to, message' }, 400);

          const digits = normalizePhone(to);
          const numberId = await session.client.getNumberId(digits);
          if (!numberId) return json({ error: `El número ${to} no tiene WhatsApp activo` }, 404);

          const chatId = numberId._serialized;
          let msgResult;
          if (mediaUrl) {
            const media = await MessageMedia.fromUrl(mediaUrl);
            msgResult = await session.client.sendMessage(chatId, media, { caption: message || '' });
          } else {
            msgResult = await session.client.sendMessage(chatId, message);
          }

          const messageId = msgResult?.id?.id || `wa-out-${Date.now()}`;
          if (msgResult?.id?.id) session.recentSentIds.add(msgResult.id.id);

          if (!fromCrm) {
            await saveMessage(session, { phone: digits, body: message, mediaUrl, messageId, senderType: 'agent' });
          }

          json({ success: true, messageId });
          log(accountId, `✅ Mensaje enviado a ${to}`);
        } catch (err) {
          console.error(`[WA][${accountId.slice(0, 8)}] Error enviando:`, err.message);
          if (err.message?.match(/detached Frame|Session closed/)) restartSession(session, err.message);
          if (!res.headersSent) json({ error: err.message }, 500);
        }
      });
      return;
    }
  }

  // ── GET / — dashboard HTML ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/') {
    const rows = [...sessions.entries()].map(([id, s]) =>
      `<tr>
        <td style="font-size:11px;color:#64748b">${id}</td>
        <td><span style="color:${s.status === 'ready' ? '#22c55e' : s.status === 'qr' ? '#f59e0b' : '#94a3b8'};font-weight:600">${s.status}</span></td>
        <td>${s.phone || '—'}</td>
        <td><a href="/sessions/${id}/qr">Ver QR</a> · <a href="/sessions/${id}/status">JSON</a></td>
      </tr>`
    ).join('');

    return html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WA Multi-Tenant Service</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:40px;line-height:1.6}
h1{font-size:24px;margin-bottom:4px}p.sub{color:#64748b;margin-bottom:28px}
table{border-collapse:collapse;width:100%;margin-bottom:24px}
th,td{padding:12px 16px;border:1px solid #1e293b;text-align:left}
th{background:#1e293b;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}
a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;background:#1e293b}</style>
</head><body>
<h1>🟢 WhatsApp Multi-Tenant Service</h1>
<p class="sub">Sesiones activas: <strong>${sessions.size}</strong> · Versión: SaaS Multi-Tenant</p>
<table>
  <thead><tr><th>Account ID</th><th>Estado</th><th>Teléfono</th><th>Acciones</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" style="color:#475569;text-align:center;padding:32px">Sin sesiones activas.<br><small>POST /sessions/:accountId/start para iniciar una cuenta.</small></td></tr>'}</tbody>
</table>
<p style="color:#475569;font-size:13px">
  <strong>API:</strong><br>
  POST /sessions/:accountId/start — Iniciar sesión<br>
  POST /sessions/:accountId/stop — Detener sesión<br>
  GET  /sessions/:accountId/qr — Ver QR para escanear<br>
  POST /sessions/:accountId/send — Enviar mensaje
</p>
</body></html>`);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: url.pathname }));
});

server.listen(PORT, async () => {
  console.log(`\n🚀 WhatsApp Multi-Tenant Service — http://localhost:${PORT}`);
  console.log(`📋 Dashboard: http://localhost:${PORT}/`);
  console.log(`📡 API: POST /sessions/:accountId/start\n`);
  await loadAllSessions();
});
