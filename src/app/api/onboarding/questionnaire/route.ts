import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  type OnboardingQuestionnaireData,
  DEFAULT_QUESTIONNAIRE_DATA,
  generateSystemPromptFromQuestionnaire,
} from '@/types/onboarding';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const supabase = await createClient();

    // 1. Obtener respuestas previas si existen
    const { data: savedResponse } = await supabase
      .from('ai_onboarding_responses')
      .select('answers, generated_prompt, updated_at')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    // 2. Obtener estado actual de IA
    const { data: aiConfig } = await supabase
      .from('ai_configs')
      .select('provider, model, is_active, auto_reply_enabled, system_prompt, api_key')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const currentAnswers: OnboardingQuestionnaireData = savedResponse?.answers
      ? {
          ...DEFAULT_QUESTIONNAIRE_DATA,
          ...savedResponse.answers,
          businessName: savedResponse.answers.businessName || ctx.account.name || '',
        }
      : {
          ...DEFAULT_QUESTIONNAIRE_DATA,
          businessName: ctx.account.name || '',
          provider: (aiConfig?.provider as any) || 'groq',
          model: aiConfig?.model || 'llama-3.1-8b-instant',
        };

    return NextResponse.json({
      account: {
        id: ctx.accountId,
        name: ctx.account.name,
      },
      answers: currentAnswers,
      generatedPrompt: savedResponse?.generated_prompt || aiConfig?.system_prompt || null,
      aiConfigured: Boolean(aiConfig?.api_key),
      aiProvider: aiConfig?.provider || 'groq',
      aiModel: aiConfig?.model || 'llama-3.1-8b-instant',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');
    const supabase = await createClient();

    const body = (await request.json().catch(() => ({}))) as OnboardingQuestionnaireData;

    const questionnaireData: OnboardingQuestionnaireData = {
      ...DEFAULT_QUESTIONNAIRE_DATA,
      ...body,
    };

    // 1. Sintetizar prompt del sistema estructurado
    const systemPrompt = generateSystemPromptFromQuestionnaire(questionnaireData);

    // 2. Actualizar nombre de empresa en la cuenta
    if (questionnaireData.businessName && questionnaireData.businessName.trim()) {
      await supabase
        .from('accounts')
        .update({ name: questionnaireData.businessName.trim() })
        .eq('id', accountId);
    }

    // 3. Guardar respuestas completas del cuestionario
    try {
      await supabase.from('ai_onboarding_responses').upsert(
        {
          account_id: accountId,
          answers: questionnaireData,
          generated_prompt: systemPrompt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' }
      );
    } catch (saveErr) {
      console.warn('[onboarding] Could not upsert ai_onboarding_responses:', saveErr);
    }

    // 4. Actualizar o crear configuración de IA (ai_configs)
    const { data: existingAiConfig } = await supabase
      .from('ai_configs')
      .select('id, api_key')
      .eq('account_id', accountId)
      .maybeSingle();

    const provider = questionnaireData.provider || 'groq';
    const model = questionnaireData.model || (provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini');

    const updatePayload: Record<string, any> = {
      system_prompt: systemPrompt,
      is_active: true,
      auto_reply_enabled: true,
      updated_at: new Date().toISOString(),
    };

    if (questionnaireData.apiKey && questionnaireData.apiKey.trim()) {
      updatePayload.api_key = encrypt(questionnaireData.apiKey.trim());
      updatePayload.provider = provider;
      updatePayload.model = model;
    }

    if (existingAiConfig) {
      await supabase
        .from('ai_configs')
        .update(updatePayload)
        .eq('id', existingAiConfig.id);
    } else {
      // Si no existía, intentar insertar
      try {
        const insertPayload: Record<string, any> = {
          account_id: accountId,
          created_by: userId,
          provider,
          model,
          system_prompt: systemPrompt,
          is_active: true,
          auto_reply_enabled: true,
          auto_reply_max_per_conversation: 5,
          api_key: questionnaireData.apiKey?.trim()
            ? encrypt(questionnaireData.apiKey.trim())
            : encrypt('pending_key'),
        };
        await supabase.from('ai_configs').insert(insertPayload);
      } catch (insertErr) {
        console.warn('[onboarding] Could not insert initial ai_configs:', insertErr);
      }
    }

    // 5. Inyectar Base de Conocimientos (Knowledge Base Documents)
    try {
      // Documento 1: FAQs & Horarios
      const faqText = (questionnaireData.faqs || [])
        .filter((f) => f.question?.trim() && f.answer?.trim())
        .map((f, i) => `Pregunta ${i + 1}: ${f.question.trim()}\nRespuesta: ${f.answer.trim()}`)
        .join('\n\n');

      const fullFaqContent = [
        faqText ? `## Preguntas Frecuentes:\n${faqText}` : '',
        questionnaireData.locationAndHours
          ? `## Horarios de Atención, Envíos y Ubicación:\n${questionnaireData.locationAndHours}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      if (fullFaqContent) {
        const faqTitle = 'Preguntas Frecuentes y Horarios (Onboarding)';
        const { data: existingDoc } = await supabase
          .from('ai_knowledge_documents')
          .select('id')
          .eq('account_id', accountId)
          .eq('title', faqTitle)
          .maybeSingle();

        if (existingDoc) {
          await supabase
            .from('ai_knowledge_documents')
            .update({ content: fullFaqContent, updated_at: new Date().toISOString() })
            .eq('id', existingDoc.id);
        } else {
          await supabase.from('ai_knowledge_documents').insert({
            account_id: accountId,
            created_by: userId,
            title: faqTitle,
            content: fullFaqContent,
          });
        }
      }

      // Documento 2: Productos y Formas de Pago
      const productsContent = [
        questionnaireData.mainProducts ? `## Catálogo de Productos y Servicios:\n${questionnaireData.mainProducts}` : '',
        questionnaireData.paymentMethods ? `## Métodos de Pago y Promociones:\n${questionnaireData.paymentMethods}` : '',
        questionnaireData.customQuoteRequirements
          ? `## Requisitos para Cotización a Medida:\n${questionnaireData.customQuoteRequirements}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      if (productsContent) {
        const prodTitle = 'Catálogo de Servicios y Pagos (Onboarding)';
        const { data: existingDoc } = await supabase
          .from('ai_knowledge_documents')
          .select('id')
          .eq('account_id', accountId)
          .eq('title', prodTitle)
          .maybeSingle();

        if (existingDoc) {
          await supabase
            .from('ai_knowledge_documents')
            .update({ content: productsContent, updated_at: new Date().toISOString() })
            .eq('id', existingDoc.id);
        } else {
          await supabase.from('ai_knowledge_documents').insert({
            account_id: accountId,
            created_by: userId,
            title: prodTitle,
            content: productsContent,
          });
        }
      }
    } catch (kbErr) {
      console.warn('[onboarding] Could not sync knowledge base documents:', kbErr);
    }

    return NextResponse.json({
      success: true,
      message: '¡Asistente de IA entrenado y configurado exitosamente!',
      generatedPrompt: systemPrompt,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
