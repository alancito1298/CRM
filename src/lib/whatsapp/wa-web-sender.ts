/**
 * WhatsApp Web Service (Sidecar) Helper
 * Permite enviar mensajes, difusiones masivas (broadcasts), notas de voz, multimedia
 * y flujos/automatizaciones a través del número conectado por QR en localhost:3001.
 */

export interface WaWebSendParams {
  accountId: string;
  to: string;
  message?: string;
  mediaUrl?: string;
  contentType?: string;
  sendAudioAsVoice?: boolean;
}

export interface WaWebSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Comprueba si la sesión de WhatsApp Web está iniciada y lista para esta cuenta.
 */
export async function isWaWebSessionReady(
  accountId: string
): Promise<{ ready: boolean; serviceUrl: string }> {
  const waServiceUrl = process.env.WA_SERVICE_URL || 'http://localhost:3001';
  try {
    // 1. Intentar endpoint multi-tenant por accountId
    const res = await fetch(`${waServiceUrl}/sessions/${accountId}/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = (await res.json()) as { status: string };
      if (data.status === 'ready') return { ready: true, serviceUrl: waServiceUrl };
    }

    // 2. Fallback por compatibilidad con sesión global única
    const globRes = await fetch(`${waServiceUrl}/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (globRes.ok) {
      const data = (await globRes.json()) as { status: string };
      if (data.status === 'ready') return { ready: true, serviceUrl: waServiceUrl };
    }
  } catch {}

  return { ready: false, serviceUrl: waServiceUrl };
}

/**
 * Envía un mensaje a través del sidecar de WhatsApp Web.
 */
export async function sendViaWaWebService(
  params: WaWebSendParams
): Promise<WaWebSendResult> {
  const waServiceUrl = process.env.WA_SERVICE_URL || 'http://localhost:3001';
  const { accountId, to, message, mediaUrl, contentType, sendAudioAsVoice } = params;

  try {
    // 1. Intentar endpoint multi-tenant
    const res = await fetch(`${waServiceUrl}/sessions/${accountId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        message: message || '',
        mediaUrl: mediaUrl || undefined,
        contentType: contentType || 'text',
        sendAudioAsVoice: Boolean(sendAudioAsVoice),
        fromCrm: true,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) {
      const data = (await res.json()) as { messageId?: string };
      return { success: true, messageId: data.messageId || `wa-web-${Date.now()}` };
    }

    // 2. Fallback sesión global
    const globRes = await fetch(`${waServiceUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        message: message || '',
        mediaUrl: mediaUrl || undefined,
        fromCrm: true,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (globRes.ok) {
      const data = (await globRes.json()) as { messageId?: string };
      return { success: true, messageId: data.messageId || `wa-web-${Date.now()}` };
    }

    const errData = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      success: false,
      error: errData.error || 'Error al enviar mediante WhatsApp Web',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Error de conexión con el servicio de WhatsApp Web',
    };
  }
}
