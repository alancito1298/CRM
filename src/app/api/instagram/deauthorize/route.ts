import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { disconnectInstagramChannel } from '@/lib/instagram/connection';

// Meta calls this when someone removes the app from their Instagram
// settings. The body carries a `signed_request` (HMAC-SHA256 with the app
// secret); the matching channel is disconnected so the CRM shows it.
export async function POST(request: Request) {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  const form = await request.formData().catch(() => null);
  const signed = form?.get('signed_request');
  if (!secret || typeof signed !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const userId = parseSignedRequest(signed, secret);
  if (!userId) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });

  const db = supabaseAdmin();
  const [byProfessionalId, byOauthId] = await Promise.all([
    db.from('channels').select('id').eq('type', 'instagram').eq('external_id', userId),
    db.from('channels').select('id').eq('type', 'instagram').eq('metadata->>oauth_user_id', userId),
  ]);
  const ids = new Set([...(byProfessionalId.data ?? []), ...(byOauthId.data ?? [])].map((c) => c.id));
  for (const id of ids) await disconnectInstagramChannel(id);
  return NextResponse.json({ ok: true });
}

function parseSignedRequest(signed: string, secret: string): string | null {
  const [signature, payload] = signed.split('.');
  if (!signature || !payload) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { user_id?: string | number };
    return data.user_id ? String(data.user_id) : null;
  } catch {
    return null;
  }
}
