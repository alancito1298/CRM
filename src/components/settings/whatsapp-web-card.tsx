'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import {
  QrCode,
  Smartphone,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Power,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';

interface SessionStatusResponse {
  accountId: string;
  status: 'disconnected' | 'initializing' | 'qr' | 'authenticated' | 'ready' | 'error' | 'stopped';
  phone?: string | null;
  qr?: string | null;
  error?: string;
  message?: string;
}

export function WhatsAppWebCard() {
  const { accountId, canEditSettings } = useAuth();
  const [session, setSession] = useState<SessionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/service', { cache: 'no-store' });
      if (res.ok) {
        const data: SessionStatusResponse = await res.json();
        setSession(data);

        // Si tenemos un string QR, convertirlo a imagen Data URL
        if (data.qr) {
          try {
            const url = await QRCode.toDataURL(data.qr, {
              width: 260,
              margin: 2,
              color: {
                dark: '#000000',
                light: '#ffffff',
              },
            });
            setQrDataUrl(url);
          } catch (qrErr) {
            console.error('Error generating QR image:', qrErr);
          }
        } else {
          setQrDataUrl(null);
        }
      }
    } catch (err) {
      console.warn('Could not poll WhatsApp service:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll mientras esté en inicialización o esperando QR
  useEffect(() => {
    fetchStatus();

    const interval = setInterval(() => {
      fetchStatus();
    }, 3500);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleStart = async (restart: boolean = false) => {
    try {
      setActionLoading(true);
      setSession((prev) => ({
        accountId: prev?.accountId || accountId || '',
        status: 'initializing',
      }));

      const res = await fetch('/api/whatsapp/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: restart ? 'restart' : 'start' }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Error al iniciar sesión de WhatsApp');
      }

      const data = await res.json();
      if (data.qr) {
        try {
          const url = await QRCode.toDataURL(data.qr, {
            width: 260,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          setQrDataUrl(url);
        } catch (e) {
          console.error(e);
        }
      }
      if (data.status) {
        setSession((prev) => ({ ...prev, ...data }));
      }

      toast.info(restart ? 'Reiniciando vinculación...' : 'Iniciando WhatsApp... El código QR aparecerá en unos segundos.');
      await fetchStatus();
    } catch (err: any) {
      toast.error(err.message || 'Error al conectar WhatsApp');
      await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('¿Estás seguro de que deseas desconectar esta cuenta de WhatsApp?')) {
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch('/api/whatsapp/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Error al desconectar');
      }

      toast.success('Sesión de WhatsApp desconectada');
      await fetchStatus();
    } catch (err: any) {
      toast.error(err.message || 'Error al desconectar');
    } finally {
      setActionLoading(false);
    }
  };

  const isConnected = session?.status === 'ready';
  const isWaitingQR = session?.status === 'qr';
  const isInitializing = session?.status === 'initializing';

  return (
    <Card className="border border-border/80 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 bg-muted/20 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Smartphone className="size-5 text-emerald-500" />
            <CardTitle className="text-lg font-bold">WhatsApp Web Multidispositivo</CardTitle>
            {isConnected ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                ● Conectado
              </Badge>
            ) : isWaitingQR ? (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs">
                Esperando escaneo
              </Badge>
            ) : isInitializing ? (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs">
                Iniciando...
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">
                Desconectado
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs">
            Conecta tu propio número de WhatsApp al CRM al instante escaneando el código QR desde tu teléfono.
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          {isConnected && (
            <Button
              variant="destructive"
              size="sm"
              disabled={actionLoading || !canEditSettings}
              onClick={handleStop}
              className="gap-1.5 text-xs"
            >
              {actionLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
              Desconectar
            </Button>
          )}

          {!isConnected && !isWaitingQR && !isInitializing && (
            <Button
              size="sm"
              disabled={actionLoading || !canEditSettings}
              onClick={() => handleStart(false)}
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {actionLoading ? <Loader2 className="size-3.5 animate-spin" /> : <QrCode className="size-3.5" />}
              Vincular con Código QR
            </Button>
          )}

          {(isWaitingQR || isInitializing) && (
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading}
              onClick={fetchStatus}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="size-3.5" />
              Actualizar
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span className="text-sm">Comprobando estado del servicio...</span>
          </div>
        ) : isConnected ? (
          /* ─── ESTADO: CONECTADO ─── */
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="size-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
                <CheckCircle2 className="size-6" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm">Sesión vinculada activamente</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Número sincronizado: <strong className="text-foreground">{session?.phone || 'WhatsApp Activo'}</strong>
                </p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                  ✓ Mensajes entrantes sincronizados con la bandeja de entrada
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={fetchStatus}
              className="text-xs shrink-0"
            >
              Verificar sincronización
            </Button>
          </div>
        ) : isWaitingQR ? (
          /* ─── ESTADO: ESPERANDO ESCANEO QR ─── */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center py-2">
            <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl shadow-sm border border-border/80 w-fit mx-auto">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="Código QR de WhatsApp"
                  className="size-64 rounded-lg object-contain"
                />
              ) : (
                <div className="size-64 flex items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              )}
              <span className="text-[11px] font-medium text-slate-500 mt-2">
                El código se actualiza automáticamente
              </span>
            </div>

            <div className="space-y-4">
              <h4 className="font-bold text-base text-foreground">
                Pasos para conectar tu WhatsApp:
              </h4>

              <ol className="space-y-3 text-xs text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <span className="size-5 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0 text-[11px]">
                    1
                  </span>
                  <span>Abre <strong>WhatsApp</strong> en tu teléfono móvil.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="size-5 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0 text-[11px]">
                    2
                  </span>
                  <span>
                    Toca en <strong>Configuración</strong> (iPhone) o el menú de <strong>tres puntos</strong> (Android) y selecciona <strong>Dispositivos vinculados</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="size-5 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0 text-[11px]">
                    3
                  </span>
                  <span>
                    Toca en <strong>Vincular un dispositivo</strong> y apunta tu cámara hacia el código QR de la izquierda.
                  </span>
                </li>
              </ol>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionLoading}
                  onClick={() => handleStart(true)}
                  className="text-xs gap-1.5"
                >
                  <RefreshCw className="size-3.5" />
                  Regenerar nuevo QR
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={actionLoading}
                  onClick={handleStop}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancelar vinculación
                </Button>
              </div>
            </div>
          </div>
        ) : isInitializing ? (
          /* ─── ESTADO: INICIALIZANDO ─── */
          <div className="text-center py-10 space-y-3">
            <Loader2 className="size-8 animate-spin text-primary mx-auto" />
            <h4 className="font-semibold text-sm text-foreground">
              Preparando sesión de WhatsApp...
            </h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Iniciando el navegador virtual y generando el código QR de vinculación. Esto toma unos segundos.
            </p>
          </div>
        ) : (
          /* ─── ESTADO: DESCONECTADO ─── */
          <div className="text-center py-8 space-y-3 max-w-md mx-auto">
            <div className="size-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground mx-auto">
              <QrCode className="size-6" />
            </div>
            <h4 className="font-semibold text-sm text-foreground">
              No tienes ningún WhatsApp vinculado
            </h4>
            <p className="text-xs text-muted-foreground">
              Para empezar a chatear y que la IA atienda a tus clientes, vincula tu número escaneando el código QR desde tu app de WhatsApp.
            </p>
            <div className="pt-2">
              <Button
                onClick={() => handleStart(false)}
                disabled={actionLoading || !canEditSettings}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-semibold"
              >
                {actionLoading ? <Loader2 className="size-3.5 animate-spin" /> : <QrCode className="size-3.5" />}
                Generar Código QR para Vincular
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
