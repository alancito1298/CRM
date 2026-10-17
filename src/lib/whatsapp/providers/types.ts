// ============================================================
// WhatsApp provider contract.
//
// Every outbound path (manual send, public API, Flows, Automations,
// AI auto-reply, broadcasts) talks to a `WhatsAppProvider` instead of
// calling Meta / Twilio / the WA Web sidecar directly. Which provider
// an account uses is decided in ONE place — `resolveProvider()` — so
// adding a provider or changing precedence never touches the callers.
// ============================================================

import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';

export type ProviderId = 'meta' | 'twilio' | 'wa-web';

export type OutboundMessage =
  | { type: 'text'; text: string }
  | {
      type: 'media';
      kind: MediaKind;
      url: string;
      caption?: string;
      /** Document-only. */
      filename?: string;
    }
  | {
      type: 'template';
      name: string;
      language: string;
      /** Local `message_templates` row — needed for header/buttons, and
       *  by text-only providers to render the body. */
      template?: MessageTemplate | null;
      /** Legacy positional body params ({{1}}, {{2}}…). */
      params?: string[];
      /** Structured per-send values (header/body/buttons). */
      messageParams?: SendTimeParams;
    }
  | { type: 'interactive'; payload: InteractiveMessagePayload };

export interface SendOptions {
  /** Provider message id of the message being replied to (Meta only). */
  contextMessageId?: string;
}

export interface ProviderSendResult {
  /** Provider-side message id (Meta wamid, Twilio SID, WA Web id). */
  messageId: string;
  /** Set when the provider flattened a template/interactive message to
   *  plain text — the text that actually reached the customer. */
  renderedText?: string;
}

export interface WhatsAppProvider {
  readonly id: ProviderId;
  /** Pause between consecutive sends of a bulk send (anti-ban pacing). */
  bulkDelayMs(): number;
  send(
    to: string,
    message: OutboundMessage,
    options?: SendOptions
  ): Promise<ProviderSendResult>;
}

/** No provider is connected/configured for the account. */
export class WhatsAppNotConfiguredError extends Error {
  constructor(
    message = 'WhatsApp no está conectado ni configurado. Conecta tu WhatsApp escaneando el código QR en Ajustes o configura tus credenciales de Meta Cloud API.'
  ) {
    super(message);
    this.name = 'WhatsAppNotConfiguredError';
  }
}
