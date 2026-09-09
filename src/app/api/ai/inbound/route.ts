import { NextResponse } from 'next/server'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { accountId, conversationId, contactId, configOwnerUserId } = body

    if (!accountId || !conversationId || !contactId || !configOwnerUserId) {
      return NextResponse.json(
        { error: 'Missing required fields: accountId, conversationId, contactId, configOwnerUserId' },
        { status: 400 }
      )
    }

    // Run async dispatch without blocking response
    dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
    }).catch((err) => {
      console.error('[ai/inbound] dispatch error:', err)
    })

    return NextResponse.json({ ok: true, queued: true }, { status: 202 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[ai/inbound] error handling request:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
