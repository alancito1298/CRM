// ============================================================
// Plain-text rendering for providers without native templates or
// interactive messages (WA Web, Twilio sandbox). One implementation so
// every send path flattens messages the same way.
// ============================================================

import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { OutboundMessage } from './types';

type TemplateMessage = Extract<OutboundMessage, { type: 'template' }>;

function fillVariables(text: string, values: string[]): string {
  return values.reduce(
    (acc, val, idx) =>
      acc.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), val || ''),
    text
  );
}

/** Template → text (+ header media URL, if any). */
export function renderTemplateText(msg: TemplateMessage): {
  text: string;
  mediaUrl?: string;
} {
  const t = msg.template;
  const bodyValues = msg.messageParams?.body ?? msg.params ?? [];
  const body = fillVariables(t?.body_text || `[${msg.name}]`, bodyValues);

  const parts: string[] = [];
  if (t?.header_type === 'text' && t.header_content) {
    const headerText = msg.messageParams?.headerText;
    parts.push(
      `*${headerText ? fillVariables(t.header_content, [headerText]) : t.header_content}*`
    );
  }
  if (body) parts.push(body);
  if (t?.footer_text) parts.push(`_${t.footer_text}_`);
  if (t?.buttons?.length) {
    parts.push(
      t.buttons
        .map((b) => {
          if (b.type === 'URL' && b.url) return `👉 ${b.text}: ${b.url}`;
          if (b.type === 'PHONE_NUMBER' && b.phone_number)
            return `📞 ${b.text}: ${b.phone_number}`;
          return `• ${b.text}`;
        })
        .join('\n')
    );
  }

  const mediaUrl =
    msg.messageParams?.headerMediaUrl ||
    (t?.header_type && t.header_type !== 'text' ? t.header_media_url : undefined);

  return { text: parts.join('\n\n'), mediaUrl: mediaUrl || undefined };
}

/** Reply buttons / list → numbered text menu. */
export function renderInteractiveText(p: InteractiveMessagePayload): string {
  let text = '';
  if (p.header) text += `*${p.header}*\n\n`;
  text += p.body + '\n\n';

  if (p.kind === 'buttons') {
    p.buttons.forEach((b, i) => {
      text += `${i + 1}️⃣ *${b.title}*\n`;
    });
    text += '\n_Responde con el número o nombre de tu opción_';
  } else {
    p.sections.forEach((sec) => {
      if (sec.title) text += `📂 *${sec.title}*\n`;
      sec.rows.forEach((r) => {
        text += `• *${r.title}*${r.description ? ` (${r.description})` : ''}\n`;
      });
    });
    text += '\n_Responde con la opción deseada_';
  }
  if (p.footer) text += `\n\n_${p.footer}_`;
  return text;
}

/**
 * Flatten any outbound message to `{ text, mediaUrl }`. `rendered` is
 * true when the text differs from what a native provider would send
 * (template / interactive), so callers can persist what was delivered.
 */
export function renderAsText(msg: OutboundMessage): {
  text: string;
  mediaUrl?: string;
  rendered: boolean;
} {
  switch (msg.type) {
    case 'text':
      return { text: msg.text, rendered: false };
    case 'media':
      return { text: msg.caption ?? '', mediaUrl: msg.url, rendered: false };
    case 'template':
      return { ...renderTemplateText(msg), rendered: true };
    case 'interactive':
      return { text: renderInteractiveText(msg.payload), rendered: true };
  }
}
