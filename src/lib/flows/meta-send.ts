import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api'
import { sendBotMessage } from '@/lib/channels/bot-send'

// ------------------------------------------------------------
// Flows-side sender. Thin adapter over `sendBotMessage`, which routes
// through the conversation's channel (WhatsApp, Instagram, …) and owns
// persistence for every bot send. Signatures are kept stable for
// the runner and the AI auto-reply.
// ------------------------------------------------------------

interface EngineArgs {
  /** Account-level tenancy key. Drives contact + provider lookups so
   *  a flow authored by user A still sends through the WhatsApp number
   *  user B connected on the same account. */
  accountId: string
  /** Original author of the flow — kept for logs/audit; not consulted
   *  for tenancy. */
  userId: string
  conversationId: string
  contactId: string
}

interface SendTextEngineArgs extends EngineArgs {
  text: string
  /** Marks the persisted row `ai_generated = true` so the inbox badges
   *  it as an AI reply. Only the auto-reply bot sets this. */
  aiGenerated?: boolean
}

interface SendMediaEngineArgs extends EngineArgs {
  kind: MediaKind
  /** Public URL the provider fetches at send time. */
  link: string
  caption?: string
  /** Document-only. */
  filename?: string
}

interface SendInteractiveButtonsEngineArgs extends EngineArgs {
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs extends EngineArgs {
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/** Plain text — `send_message` / `collect_input` nodes and AI replies. */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendBotMessage({ ...args, message: { type: 'text', text: args.text } })
}

/** Image / video / document / audio — the `send_media` node. */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendBotMessage({
    ...args,
    message: {
      type: 'media',
      kind: args.kind,
      url: args.link,
      caption: args.caption,
      filename: args.filename,
    },
  })
}

/** Reply buttons (≤3 options). */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendBotMessage({
    ...args,
    message: {
      type: 'interactive',
      payload: {
        kind: 'buttons',
        body: args.bodyText,
        header: args.headerText,
        footer: args.footerText,
        buttons: args.buttons,
      },
    },
  })
}

/** List message — when the flow needs more than 3 options. */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendBotMessage({
    ...args,
    message: {
      type: 'interactive',
      payload: {
        kind: 'list',
        body: args.bodyText,
        header: args.headerText,
        footer: args.footerText,
        button_label: args.buttonLabel,
        sections: args.sections,
      },
    },
  })
}
