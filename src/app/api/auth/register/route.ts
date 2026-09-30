import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/whatsapp/encryption';
import { STATIC_PLANS } from '@/lib/saas/plans';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      fullName?: string;
      companyName?: string;
      email?: string;
      password?: string;
      planSlug?: string;
    };

    const fullName = body.fullName?.trim() || '';
    const companyName = body.companyName?.trim() || 'Mi Empresa';
    const email = body.email?.trim().toLowerCase() || '';
    const password = body.password || '';
    const planSlug = body.planSlug || 'free';

    if (!email || !password) {
      return NextResponse.json(
        { error: 'El correo electrónico y la contraseña son obligatorios' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres' },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // ─── 1. CREAR EL USUARIO EN SUPABASE AUTH ────────────────────────────────
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        company_name: companyName,
        plan_slug: planSlug,
      },
    });

    if (authError) {
      console.error('[Register API] Error creando usuario:', authError.message);
      if (
        authError.message.includes('already registered') ||
        authError.message.includes('unique') ||
        authError.message.includes('exists')
      ) {
        return NextResponse.json(
          { error: 'Este correo electrónico ya está registrado. Por favor inicia sesión.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const user = authData.user;
    if (!user) {
      return NextResponse.json({ error: 'No se pudo crear el usuario' }, { status: 500 });
    }

    // ─── 2. APROVISIONAR EL TENANT (ACCOUNTS & PROFILES) ─────────────────────
    let accountId: string | null = null;

    // Verificar si el trigger de PostgreSQL ya creó el profile y account
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingProfile?.account_id) {
      accountId = existingProfile.account_id;
      // Actualizar el nombre de la empresa ingresado por el usuario
      await admin
        .from('accounts')
        .update({ name: companyName })
        .eq('id', accountId);
    } else {
      // Fallback seguro: crear cuenta y perfil manualmente
      const { data: newAccount, error: accErr } = await admin
        .from('accounts')
        .insert({
          name: companyName,
          owner_user_id: user.id,
        })
        .select('id')
        .single();

      if (accErr || !newAccount) {
        console.error('[Register API] Error creando cuenta:', accErr);
        throw new Error('No se pudo inicializar la organización');
      }

      accountId = newAccount.id;

      await admin.from('profiles').upsert(
        {
          user_id: user.id,
          full_name: fullName,
          email,
          account_id: accountId,
          account_role: 'owner',
        },
        { onConflict: 'user_id' }
      );
    }

    // ─── 3. APROVISIONAR SUSCRIPCIÓN DEL PLAN ────────────────────────────────
    try {
      const { data: dbPlan } = await admin
        .from('plans')
        .select('id')
        .eq('slug', planSlug)
        .maybeSingle();

      const targetPlanId = dbPlan?.id || (await admin.from('plans').select('id').eq('slug', 'free').maybeSingle()).data?.id;

      if (targetPlanId) {
        await admin.from('subscriptions').upsert(
          {
            account_id: accountId,
            plan_id: targetPlanId,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            messages_used_this_month: 0,
            broadcasts_used_this_month: 0,
          },
          { onConflict: 'account_id' }
        );
      }
    } catch (subErr) {
      console.warn('[Register API] Note: Subscriptions table check:', subErr);
    }

    // ─── 4. APROVISIONAR CONFIGURACIÓN INICIAL DE IA ─────────────────────────
    try {
      const defaultSystemPrompt = `Eres el asistente virtual oficial de "${companyName}".
Tu objetivo principal es responder consultas de los clientes por WhatsApp con tono cordial, profesional y resolutivo.
Reglas clave:
1. Responde preguntas sobre servicios, precios y horarios de atención.
2. Si no tienes la información exacta o se trata de un caso complejo, indica cordialmente que un especialista del equipo se pondrá en contacto por este mismo chat.
3. Sé conciso y claro en tus mensajes.`;

      // Clave ficticia encriptada inicial si no tiene key propia cargada
      const initialEncryptedKey = encrypt('gsk_placeholder_pending_setup');

      await admin.from('ai_configs').upsert(
        {
          account_id: accountId,
          created_by: user.id,
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          api_key: initialEncryptedKey,
          system_prompt: defaultSystemPrompt,
          is_active: true,
          auto_reply_enabled: planSlug !== 'free', // Activado por defecto en planes de pago
          auto_reply_max_per_conversation: 5,
        },
        { onConflict: 'account_id' }
      );
    } catch (aiErr) {
      console.warn('[Register API] Note: ai_configs init:', aiErr);
    }

    // ─── 5. RESPUESTA EXITOSA ────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      message: 'Cuenta creada y aprovisionada exitosamente',
      user: {
        id: user.id,
        email: user.email,
        fullName,
        companyName,
      },
      account: {
        id: accountId,
        name: companyName,
        plan: planSlug,
      },
    });
  } catch (err: any) {
    console.error('[Register API] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Error interno al registrar la cuenta' },
      { status: 500 }
    );
  }
}
