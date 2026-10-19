import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => null);
    const keepId = body?.keep_id;
    const mergeId = body?.merge_id;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof keepId !== 'string' || typeof mergeId !== 'string' ||
        !uuid.test(keepId) || !uuid.test(mergeId) || keepId === mergeId) {
      return NextResponse.json({ error: 'Choose two different contacts' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin().rpc('merge_channel_contacts', {
      p_account_id: ctx.accountId,
      p_keep_id: keepId,
      p_merge_id: mergeId,
    });
    if (error) {
      if (/both contacts|contact not found|contacts must differ/i.test(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ contact_id: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
