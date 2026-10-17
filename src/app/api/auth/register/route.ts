import { NextResponse } from 'next/server';
import { randomBytes, randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// Demo-account endpoint ("Probar Demo" on /signup).
//
// Regular signups do NOT come through here: the signup page calls
// `supabase.auth.signUp()` directly, so Supabase sends the confirmation
// email and the `handle_new_user` trigger provisions account + profile
// + Free plan. Creating users here with `email_confirm: true` for
// arbitrary emails let anyone pre-register someone else's address and
// later inherit their Google login (identity linking trusts the
// "verified" email), and the client picked its own (paid) plan.
//
// This route only mints throwaway demo users on a reserved domain
// (`.test` can never be a real mailbox), with server-generated
// credentials, and only when NEXT_PUBLIC_ENABLE_DEMO_SIGNUP=true.
// ============================================================

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_SIGNUP !== 'true') {
    return NextResponse.json({ error: 'Demo deshabilitada' }, { status: 404 });
  }

  const n = randomInt(100000, 999999);
  const email = `demo.usuario${n}@wacrm.test`;
  const password = randomBytes(18).toString('base64url');

  const { error } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `Usuario Demo ${n}`,
      company_name: `Empresa Demo ${n}`,
    },
  });

  if (error) {
    console.error('[Register API] Error creando usuario demo:', error.message);
    return NextResponse.json({ error: 'No se pudo crear la cuenta demo' }, { status: 500 });
  }

  // Account, profile and Free subscription are created by the
  // handle_new_user trigger, same as every other signup.
  return NextResponse.json({ email, password });
}
