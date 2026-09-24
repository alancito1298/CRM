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
import crypto from 'crypto';
import dotenv from 'dotenv';
import qrcode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import pkg from 'whatsapp-web.js';

dotenv.config({ path: '.env.local' });

const { Client, LocalAuth, MessageMedia } = pkg;

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.WA_SERVICE_PORT || 3001;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pjueqfhelyvejyubdkcr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqdWVxZmhlbHl2ZWp5dWJka2NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODUzOTkwOCwiZXhwIjoyMTA0MTE1OTA4fQ.ygA8b-Ns3pm2vT2yyL7eAA6rOnf24RRTAcJbPPFAVWo';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'cedc22ba5eec9ef8f35bd3fc445f0f9638ab8514125e0f1b638fca1f7e9302e3';
const CRM_PHONE = process.env.CRM_PHONE || '+5491154101146'; // Número del CRM

globalThis.WebSocket = class {};
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Estado ────────────────────────────────────────────────────────────────
let currentQR = null;
let status = 'initializing'; // initializing | qr | authenticated | ready | error
let whatsappClient = null;
let readyTimestamp = 0;

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
const recentProcessedIds = new Set();

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
    console.error('[WA-Service] Error desencriptando API key:', err.message);
    return null;
  }
}

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

// ─── Auto-Reply de Inteligencia Artificial ───────────────────────────────────
async function handleAiAutoReply({ accountId, conversationId, contactId, contactPhone }) {
  try {
    // 1. Obtener la config de IA activa para la cuenta
    const { data: config, error: cfgErr } = await supabase
      .from('ai_configs')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .maybeSingle();

    if (cfgErr || !config) {
      console.log('[WA-Service AI] No hay ai_configs activa');
      return;
    }

    if (!config.auto_reply_enabled) {
      console.log('[WA-Service AI] Auto-reply no está habilitado');
      return;
    }

    // 2. Verificar conversación
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle();

    if (convErr || !conv) return;
    if (conv.assigned_agent_id) {
      console.log(`[WA-Service AI] Hay un agente humano asignado en conv ${conversationId} — omitiendo IA`);
      return;
    }

    // Auto-heal si quedó marcado ai_autoreply_disabled por un handoff previo sin agente asignado
    if (conv.ai_autoreply_disabled) {
      await supabase
        .from('conversations')
        .update({ ai_autoreply_disabled: false, ai_handoff_summary: null })
        .eq('id', conversationId);
    }

    // El bot nunca deja de contestar mientras no haya un agente humano asignado
    if (conv.assigned_agent_id) {
      console.log(`[WA-Service AI] Hay un agente humano asignado en conv ${conversationId} — omitiendo IA`);
      return;
    }

    // 3. Obtener últimos mensajes para dar contexto/memoria a la IA (los más recientes primero)
    const { data: rawMsgs } = await supabase
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(12);

    const recentMsgs = rawMsgs ? rawMsgs.reverse() : [];

    const messages = [];
    if (config.system_prompt) {
      messages.push({ role: 'system', content: config.system_prompt });
    }

    if (recentMsgs && recentMsgs.length > 0) {
      let lastRole = null;
      let lastText = null;
      for (const m of recentMsgs) {
        if (!m.content_text) continue;
        const role = m.sender_type === 'customer' ? 'user' : 'assistant';
        const trimmed = m.content_text.trim();
        // Evitar duplicados idénticos consecutivos en el historial
        if (role === lastRole && trimmed === lastText) continue;
        messages.push({ role, content: trimmed });
        lastRole = role;
        lastText = trimmed;
      }
    }

    // Asegurarse de que el último mensaje sea del cliente para que la IA responda a él
    while (messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
      messages.pop();
    }

    // Verificar que haya al menos un mensaje del usuario
    if (messages.filter(m => m.role === 'user').length === 0) {
      return;
    }

    // 4. Desencriptar API Key
    const apiKey = decryptKey(config.api_key);
    if (!apiKey) {
      console.error('[WA-Service AI] Error: No se pudo desencriptar la API key');
      return;
    }

    const modelName = config.model || 'qwen/qwen3.8-27b';
    console.log(`[WA-Service AI] 🧠 Generando respuesta con ${config.provider} (${modelName})...`);

    // 5. Llamar al proveedor de IA
    let replyText = '';
    if (config.provider === 'groq') {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 250,
          temperature: 0.6,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        console.error(`[WA-Service AI] Error HTTP ${resp.status} de Groq:`, errBody);
      } else {
        const resJson = await resp.json();
        replyText = resJson.choices?.[0]?.message?.content?.trim() || '';
      }
    } else if (config.provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 450,
          temperature: 0.7,
        }),
      });

      if (!resp.ok) {
        console.error('[WA-Service AI] Error HTTP de OpenAI:', resp.status, await resp.text());
      } else {
        const resJson = await resp.json();
        replyText = resJson.choices?.[0]?.message?.content?.trim() || '';
      }
    } else if (config.provider === 'anthropic') {
      const systemMsg = messages.find(m => m.role === 'system')?.content || '';
      const userAndAssistantMsgs = messages.filter(m => m.role !== 'system');
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelName,
          system: systemMsg,
          messages: userAndAssistantMsgs,
          max_tokens: 450,
        }),
      });

      if (!resp.ok) {
        console.error('[WA-Service AI] Error HTTP de Anthropic:', resp.status, await resp.text());
      } else {
        const resJson = await resp.json();
        replyText = resJson.content?.[0]?.text?.trim() || '';
      }
    }

    if (!replyText) {
      console.warn('[WA-Service AI] Activando respuesta de respaldo con especialista...');
      replyText = 'Para brindarte una información más acertada y detallada sobre tu consulta, una persona especializada en el tema se pondrá en contacto contigo por este mismo chat a la brevedad. ¿A qué rubro se dedica tu negocio?';
    }

    console.log(`[WA-Service AI] 💬 Respuesta generada: "${replyText}"`);

    // 6. Enviar mensaje por WhatsApp
    const digits = normalizePhone(contactPhone);
    let chatId = `${digits}@c.us`;
    try {
      const numberId = await whatsappClient.getNumberId(digits);
      if (numberId?._serialized) chatId = numberId._serialized;
    } catch {}

    const msgResult = await whatsappClient.sendMessage(chatId, replyText);
    if (msgResult?.id?.id) recentSentIds.add(msgResult.id.id);
    if (msgResult?.id?._serialized) recentSentIds.add(msgResult.id._serialized);

    // 7. Guardar mensaje en Supabase para el CRM
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: replyText,
      message_id: messageId,
      status: 'sent',
      ai_generated: true,
    });

    await supabase
      .from('conversations')
      .update({
        last_message_text: replyText,
        last_message_at: new Date().toISOString(),
        ai_reply_count: (conv.ai_reply_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    console.log(`[WA-Service AI] ✅ Auto-reply enviado con éxito a +${digits}!`);
  } catch (err) {
    console.error('[WA-Service AI] Error en handleAiAutoReply:', err.message);
  }
}

// ─── Guardar mensaje en Supabase ───────────────────────────────────────────
async function saveMessageToSupabase({ phone, name, body, mediaUrl, mediaType, messageId, senderType = 'customer' }) {
  try {
    const cleanPhone = normalizePhone(phone);
    // Rechazar si el teléfono está vacío, es un grupo o es un broadcast
    if (!cleanPhone) return;
    if (phone && (phone.includes('@g.us') || phone.includes('broadcast'))) return;
    // Un ID de grupo normalizado tiene más de 13 dígitos — descartarlo
    if (cleanPhone.length > 15) return;

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

    // 6. Si es mensaje de cliente, disparar auto-reply de IA local y directo
    if (senderType === 'customer') {
      handleAiAutoReply({
        accountId,
        conversationId: conversation.id,
        contactId: contact.id,
        contactPhone: cleanPhone,
      }).catch((err) => {
        console.error('[WA-Service AI] Error llamando a handleAiAutoReply:', err.message);
      });
    }
  } catch (err) {
    console.error('[WA-Service] Error guardando mensaje en Supabase:', err.message);
  }
}

// ─── Polling de respaldo para mensajes recientes en WhatsApp Web ───────────
async function checkUnreadChats() {
  if (!whatsappClient?.pupPage) return;
  try {
    const latestList = await whatsappClient.pupPage.evaluate(() => {
      try {
        const { Chat } = window.require('WAWebCollections');
        const chats = Chat.getModelsArray ? Chat.getModelsArray() : [];
        const items = [];
        for (const c of chats.slice(0, 15)) {
          // Ignorar grupos
          if (c.id?._serialized?.includes('@g.us')) continue;
          const msgs = c.msgs && c.msgs.getModelsArray ? c.msgs.getModelsArray() : [];
          const last = msgs[msgs.length - 1];
          if (last && !last.id?.fromMe) {
            items.push({
              chatId: c.id?._serialized,
              name: c.name || c.formattedTitle || '',
              body: last.body || '',
              messageId: last.id?._serialized || last.id?.id || '',
              timestamp: last.t,
            });
          }
        }
        return items;
      } catch {
        return [];
      }
    });

    if (Array.isArray(latestList) && latestList.length > 0) {
      for (const item of latestList) {
        if (!item.messageId || recentProcessedIds.has(item.messageId)) continue;

        // Ignorar grupos (segunda barrera)
        if (item.chatId && item.chatId.includes('@g.us')) continue;

        // Ignorar mensajes anteriores al inicio del servicio (evita importar historial)
        if (item.timestamp && item.timestamp < readyTimestamp) continue;

        // Verificar si ya existe en Supabase
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('message_id', item.messageId)
          .maybeSingle();

        if (existing) {
          recentProcessedIds.add(item.messageId);
          continue;
        }

        recentProcessedIds.add(item.messageId);
        let senderPhone = await resolveRealPhone(item.chatId);
        console.log(`[WA-Service] 📬 Mensaje entrante detectado de +${senderPhone}: "${item.body}"`);

        await saveMessageToSupabase({
          phone: senderPhone,
          name: item.name,
          body: item.body,
          messageId: item.messageId,
          senderType: 'customer',
        });
      }
    }
  } catch (err) {
    if (err.message && (err.message.includes('detached Frame') || err.message.includes('Session closed') || err.message.includes('Target closed'))) {
      restartWhatsApp(err.message);
    }
  }
}

// ─── WhatsApp Web Client ────────────────────────────────────────────────────
function initWhatsApp() {
  setInterval(checkUnreadChats, 2500);
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

  // Cerrar periódicamente cualquier modal/popup de WhatsApp Web (ej: "What's new")
  setInterval(async () => {
    try {
      if (whatsappClient?.pupPage) {
        await whatsappClient.pupPage.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (dialog) {
            const btn = dialog.querySelector('[aria-label="Close"]') ||
                        dialog.querySelector('[data-icon="x"]')?.closest('button') ||
                        dialog.querySelector('button[aria-label="Cerrar"]') ||
                        dialog.querySelector('button');
            if (btn) btn.click();
          }
        });
      }
    } catch {}
  }, 2000);

  readyTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 min margin

  whatsappClient.on('ready', () => {
    status = 'ready';
    readyTimestamp = Math.floor(Date.now() / 1000) - 120;
    console.log('[WA-Service] ✅ WhatsApp listo para enviar y recibir mensajes');
  });

  whatsappClient.on('message', async (msg) => {
    console.log(`[WA-Service] 📨 on('message'): fromMe=${msg.fromMe}, from=${msg.from}, to=${msg.to}, timestamp=${msg.timestamp}, body="${msg.body?.slice(0, 30)}"`);
    if (msg.fromMe) return;
    if (msg.from.includes('@g.us')) return;
    if (msg.from === 'status@broadcast') return;
    if (msg.timestamp && msg.timestamp < readyTimestamp) {
      console.log(`[WA-Service] ⏩ Omitiendo mensaje antiguo (${msg.timestamp} < ${readyTimestamp})`);
      return;
    }
    if (msg.id?.id) {
      if (recentProcessedIds.has(msg.id.id)) return;
      recentProcessedIds.add(msg.id.id);
    }

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
    console.log(`[WA-Service] 📝 on('message_create'): fromMe=${msg.fromMe}, from=${msg.from}, to=${msg.to}, timestamp=${msg.timestamp}, body="${msg.body?.slice(0, 30)}"`);
    if (!msg.fromMe) return;
    if (msg.to && msg.to.includes('@g.us')) return;
    if (msg.to === 'status@broadcast') return;
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
    restartWhatsApp(`disconnected (${reason})`);
  });

  whatsappClient.on('auth_failure', (msg) => {
    status = 'error';
    console.error('[WA-Service] Error de autenticación:', msg);
  });

  whatsappClient.initialize();
}

let isRestarting = false;
async function restartWhatsApp(reason) {
  if (isRestarting) return;
  isRestarting = true;
  console.log(`[WA-Service] 🔄 Reiniciando WhatsApp Client (Motivo: ${reason})...`);
  try {
    if (whatsappClient) {
      await whatsappClient.destroy().catch(() => {});
    }
  } catch (e) {}
  whatsappClient = null;
  status = 'initializing';
  setTimeout(() => {
    isRestarting = false;
    initWhatsApp();
  }, 4000);
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
    const isConnected = status === 'ready' || status === 'authenticated' || !!whatsappClient?.info?.wid;
    res.end(JSON.stringify({ status: isConnected ? 'ready' : status, phone: realPhone, info: whatsappClient?.info || null }));
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

  // GET /debug — depuración de WhatsApp Web
  if (req.method === 'GET' && url.pathname === '/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const debugInfo = await whatsappClient?.pupPage?.evaluate(() => {
        return {
          hasWWebJS: typeof window.WWebJS !== 'undefined',
          hasOnAddMessageEvent: typeof window.onAddMessageEvent === 'function',
          hasOnMessage: typeof window.onMessage === 'function',
          title: document.title,
          url: window.location.href,
        };
      }) || null;
      res.end(JSON.stringify({ status, readyTimestamp, debugInfo }));
    } catch (e) {
      res.end(JSON.stringify({ status, readyTimestamp, error: e.message }));
    }
    return;
  }

  // GET /test-check — probar lectura directa de chats
  if (req.method === 'GET' && url.pathname === '/test-check') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const data = await whatsappClient?.pupPage?.evaluate(() => {
        try {
          const res = {};
          res.hasRequire = typeof window.require === 'function';
          if (res.hasRequire) {
            try {
              const { ChatCollection } = window.require('WAWebChatCollection');
              res.chatCollectionFound = !!ChatCollection;
              res.chatCount = ChatCollection?.models?.length;
              if (ChatCollection?.models?.length > 0) {
                res.sampleChats = ChatCollection.models.slice(0, 3).map(c => ({
                  id: c.id?._serialized,
                  name: c.name || c.formattedTitle,
                  unread: c.unreadCount,
                  msgsLen: c.msgs?.models?.length,
                  lastMsg: c.msgs?.models?.[c.msgs.models.length - 1]?.body,
                  lastFromMe: c.msgs?.models?.[c.msgs.models.length - 1]?.id?.fromMe,
                }));
              }
            } catch (e) {
              res.chatColError = e.message;
            }

            try {
              const { Msg } = window.require('WAWebCollections');
              res.msgCount = Msg?.models?.length;
            } catch (e) {
              res.msgError = e.message;
            }
          }
          return res;
        } catch (err) {
          return { error: err.message };
        }
      }) || null;
      res.end(JSON.stringify(data));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /dismiss — cerrar modales emergentes
  if (req.method === 'GET' && url.pathname === '/dismiss') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const dismissed = await whatsappClient?.pupPage?.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
          const btn = dialog.querySelector('[aria-label="Close"]') ||
                      dialog.querySelector('[data-icon="x"]')?.closest('button') ||
                      dialog.querySelector('button[aria-label="Cerrar"]') ||
                      dialog.querySelector('button');
          if (btn) {
            btn.click();
            return { closed: true, text: btn.innerText || btn.getAttribute('aria-label') };
          }
        }
        return { closed: false };
      });
      await whatsappClient?.pupPage?.keyboard?.press('Escape');
      res.end(JSON.stringify({ dismissed }));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /screenshot — captura de pantalla de WhatsApp Web
  if (req.method === 'GET' && url.pathname === '/screenshot') {
    try {
      const buffer = await whatsappClient?.pupPage?.screenshot();
      if (buffer) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(buffer);
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('No pupPage available');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error taking screenshot: ' + e.message);
    }
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
  ${status === 'ready' || status === 'authenticated' || !!whatsappClient?.info?.wid
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
    const isConnected = status === 'ready' || status === 'authenticated' || !!whatsappClient?.info?.wid;
    if (!isConnected) {
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
        if (err.message && (err.message.includes('detached Frame') || err.message.includes('Session closed') || err.message.includes('Target closed'))) {
          restartWhatsApp(err.message);
        }
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
