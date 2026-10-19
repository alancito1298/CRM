import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { registerPhoneNumber, subscribeWabaToApp, verifyPhoneNumber } from '@/lib/whatsapp/meta-api';
import { exchangeEmbeddedSignupCode, generateRegistrationPin } from '@/lib/whatsapp/embedded-signup';

// POST /api/whatsapp/embedded-signup
// Body: { code, phone_number_id, waba_id, coexistence? }
// Finishes the Embedded Signup started in the browser and saves the
// account's whatsapp_config (the channel row follows via trigger).
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => ({})) as {
      code?: string; phone_number_id?: string; waba_id?: string; coexistence?: boolean;
    };
    const { code, phone_number_id: phoneNumberId, waba_id: wabaId } = body;
    if (!code || !phoneNumberId || !wabaId) {
      return NextResponse.json({ error: 'code, phone_number_id and waba_id are required' }, { status: 400 });
    }

    const db = supabaseAdmin();
    const { data: claimed } = await db.from('whatsapp_config').select('account_id')
      .eq('phone_number_id', phoneNumberId).neq('account_id', ctx.accountId).maybeSingle();
    if (claimed) {
      return NextResponse.json({ error: 'in_use' }, { status: 409 });
    }

    const accessToken = await exchangeEmbeddedSignupCode(code);
    const phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken });
    await subscribeWabaToApp({ wabaId, accessToken });

    // A number shared with the WhatsApp Business app (coexistence) must
    // not be registered: /register would log the phone app out.
    let registeredAt: string | null = null;
    let registrationError: string | null = null;
    if (!body.coexistence) {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken, pin: generateRegistrationPin() });
        registeredAt = new Date().toISOString();
      } catch (error) {
        registrationError = error instanceof Error ? error.message : 'Registration failed';
        console.warn('[whatsapp] embedded signup /register failed:', registrationError);
      }
    } else {
      registeredAt = new Date().toISOString();
    }

    const now = new Date().toISOString();
    const row = {
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: encrypt(accessToken),
      verify_token: null,
      status: 'connected',
      connected_at: now,
      registered_at: registeredAt,
      subscribed_apps_at: now,
      last_registration_error: registrationError,
      updated_at: now,
    };
    const { data: existing } = await db.from('whatsapp_config').select('id')
      .eq('account_id', ctx.accountId).maybeSingle();
    const { error } = existing
      ? await db.from('whatsapp_config').update(row).eq('id', existing.id)
      : await db.from('whatsapp_config').insert({ account_id: ctx.accountId, user_id: ctx.userId, ...row });
    if (error) {
      console.error('[whatsapp] embedded signup save failed:', error);
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true, phone_info: phoneInfo, registration_error: registrationError });
  } catch (error) {
    return toErrorResponse(error);
  }
}
