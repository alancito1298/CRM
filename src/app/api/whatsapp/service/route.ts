import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';

const WA_SERVICE_URL = process.env.WA_SERVICE_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const accountId = ctx.accountId;

    try {
      const res = await fetch(`${WA_SERVICE_URL}/sessions/${accountId}/status`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        return NextResponse.json({
          status: 'disconnected',
          message: 'Servicio no iniciado o no conectado',
          accountId,
        });
      }

      const data = await res.json();
      return NextResponse.json(data);
    } catch (serviceErr: any) {
      return NextResponse.json({
        status: 'disconnected',
        error: serviceErr.message,
        message: 'No se pudo conectar con el servicio de WhatsApp. Asegúrate de que esté activo.',
        accountId,
      });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const accountId = ctx.accountId;

    const body = (await request.json().catch(() => ({}))) as {
      action?: 'start' | 'stop' | 'restart';
    };

    const action = body.action || 'start';

    try {
      const endpoint = `${WA_SERVICE_URL}/sessions/${accountId}/${action}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (serviceErr: any) {
      return NextResponse.json(
        {
          error: serviceErr.message,
          message: 'Error al comunicarse con el servicio de WhatsApp',
        },
        { status: 502 }
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
