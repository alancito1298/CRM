'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import {
  QrCode,
  Smartphone,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Power,
  Copy,
  Check,
  KeyRound,
  ShieldCheck,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

interface SessionStatusResponse {
  accountId: string;
  status: 'disconnected' | 'initializing' | 'qr' | 'pairing_code' | 'authenticated' | 'ready' | 'error' | 'stopped';
  phone?: string | null;
  qr?: string | null;
  pairingCode?: string | null;
  error?: string;
  message?: string;
}

export function WhatsAppWebCard() {
  const { accountId, canEditSettings } = useAuth();
  const [session, setSession] = useState<SessionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'qr' | 'pairing'>('qr');
  const [pairingPhone, setPairingPhone] = useState('');
  const [copied, setCopied] = useState(false);

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

        // Si recibimos un pairingCode activo, cambiar pestaña a pairing
        if (data.pairingCode) {
          setActiveTab('pairing');
        }
      }
    } catch (err) {
      console.warn('Could not poll WhatsApp service:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll mientras esté en inicialización, esperando QR o esperando confirmación del pairing code
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

      toast.info(restart ? 'Reiniciando vinculación...' : 'Iniciando WhatsApp... El código aparecerá en unos segundos.');
      await fetchStatus();
    } catch (err: any) {
      toast.error(err.message || 'Error al conectar WhatsApp');
      await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestPairingCode = async () => {
    const clean = pairingPhone.replace(/[^0-9]/g, '');
    if (!clean || clean.length < 8) {
      toast.error('Ingresa un número telefónico válido con código de país (ej: +54 9 11...)');
      return;
    }

    try {
      setActionLoading(true);
      setSession((prev) => ({
        accountId: prev?.accountId || accountId || '',
        status: 'initializing',
      }));

      const res = await fetch('/api/whatsapp/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pairing-code',
          phone: clean,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al solicitar el código de vinculación');
      }

      if (data.pairingCode) {
        setSession((prev) => ({ ...prev, ...data, status: 'pairing_code' }));
        toast.success('¡Código generado! Ingrésalo en WhatsApp en tu teléfono.');
      } else {
        toast.info(data.message || 'Iniciando conexión para generar el código...');
      }

      await fetchStatus();
    } catch (err: any) {
      toast.error(err.message || 'No se pudo generar el código');
      await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelPairingCode = async () => {
    try {
      setActionLoading(true);
      await fetch('/api/whatsapp/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel-pairing-code' }),
      });
      toast.info('Modo de vinculación cancelado');
      setActiveTab('qr');
      await fetchStatus();
    } catch {
      toast.error('Error al cancelar');
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

  const copyPairingCode = () => {
    if (!session?.pairingCode) return;
    navigator.clipboard.writeText(session.pairingCode);
    setCopied(true);
    toast.success('Código copiado al portapapeles');
    setTimeout(() => setCopied(false), 2000);
  };

  const isConnected = session?.status === 'ready';
  const isPairingCode = session?.status === 'pairing_code' && !!session?.pairingCode;
  const isWaitingQR = session?.status === 'qr';
  const isInitializing = session?.status === 'initializing';

  // Separar los 8 caracteres en 2 bloques de 4 para visualización clara
  const codeChars = (session?.pairingCode || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const part1 = codeChars.slice(0, 4);
  const part2 = codeChars.slice(4, 8);

  return (
    <Card className="border border-border/80 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 bg-muted/20 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Smartphone className="size-5 text-emerald-500" />
            <CardTitle className="text-lg font-bold">WhatsApp Web Multidispositivo</CardTitle>
            {isConnected ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Conectado
              </Badge>
            ) : isPairingCode ? (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs">
                Esperando código en móvil
              </Badge>
            ) : isWaitingQR ? (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs">
                Esperando escaneo QR
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
            Conecta tu propio número de WhatsApp al CRM mediante código QR o código de vinculación telefónico de 8 dígitos.
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

          {!isConnected && !isWaitingQR && !isPairingCode && !isInitializing && (
            <Button
              size="sm"
              disabled={actionLoading || !canEditSettings}
              onClick={() => handleStart(false)}
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {actionLoading ? <Loader2 className="size-3.5 animate-spin" /> : <QrCode className="size-3.5" />}
              Iniciar Vinculación
            </Button>
          )}

          {(isWaitingQR || isPairingCode || isInitializing) && (
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
                  ✓ Mensajes entrantes sincronizados con la bandeja de entrada y respuestas de IA habilitadas
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
        ) : (
          /* ─── ESTADO: NO CONECTADO / EN VINCULACIÓN ─── */
          <div className="space-y-6">
            {/* Selector de Método (Tabs) */}
            <div className="flex items-center justify-center">
              <div className="inline-flex p-1 bg-muted rounded-xl border border-border/60">
                <button
                  type="button"
                  onClick={() => setActiveTab('qr')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'qr'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <QrCode className="size-4" />
                  Escanear Código QR
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('pairing')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'pairing'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <KeyRound className="size-4 text-emerald-500" />
                  Vincular con Código (8 dígitos)
                </button>
              </div>
            </div>

            {/* TAB 1: CÓDIGO QR */}
            {activeTab === 'qr' && (
              <>
                {isWaitingQR ? (
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
                        Pasos para escanear el código QR:
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
                            Toca en <strong>Configuración</strong> (iPhone) o el menú de <strong>tres puntos ⋮</strong> (Android) y selecciona <strong>Dispositivos vinculados</strong>.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <span className="size-5 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0 text-[11px]">
                            3
                          </span>
                          <span>
                            Toca en <strong>Vincular un dispositivo</strong> y apunta tu cámara hacia el código QR.
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
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : isInitializing ? (
                  <div className="text-center py-10 space-y-3">
                    <Loader2 className="size-8 animate-spin text-primary mx-auto" />
                    <h4 className="font-semibold text-sm text-foreground">
                      Iniciando WhatsApp Web...
                    </h4>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Iniciando el navegador virtual y generando el código QR de vinculación. Esto toma unos segundos.
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-8 space-y-3 max-w-md mx-auto">
                    <div className="size-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground mx-auto">
                      <QrCode className="size-6" />
                    </div>
                    <h4 className="font-semibold text-sm text-foreground">
                      Vincular mediante Código QR
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Haz clic abajo para generar el código QR y escanearlo con la cámara de tu teléfono móvil desde la app de WhatsApp.
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
              </>
            )}

            {/* TAB 2: CÓDIGO DE 8 DÍGITOS (PAIRING CODE) */}
            {activeTab === 'pairing' && (
              <div className="max-w-xl mx-auto space-y-6">
                {isPairingCode ? (
                  /* ─── CÓDIGO GENERADO ACTIVO ─── */
                  <div className="p-6 rounded-2xl border border-primary/20 bg-primary/5 text-center space-y-5">
                    <div className="space-y-1">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs gap-1 mx-auto">
                        <Sparkles className="size-3" />
                        Código listo para ingresar
                      </Badge>
                      <h4 className="font-bold text-base text-foreground mt-2">
                        Ingresa este código en tu celular
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Abre WhatsApp y escribe exactamente este código de 8 caracteres:
                      </p>
                    </div>

                    {/* Mosaico de Dígitos */}
                    <div className="flex items-center justify-center gap-2 sm:gap-3 py-2">
                      <div className="flex gap-1 sm:gap-1.5">
                        {part1.split('').map((char, i) => (
                          <div
                            key={`p1-${i}`}
                            className="size-10 sm:size-12 rounded-xl bg-card border-2 border-primary/40 font-mono font-black text-xl sm:text-2xl text-primary flex items-center justify-center shadow-sm"
                          >
                            {char}
                          </div>
                        ))}
                      </div>
                      <span className="text-xl sm:text-2xl font-bold text-muted-foreground px-1">-</span>
                      <div className="flex gap-1 sm:gap-1.5">
                        {part2.split('').map((char, i) => (
                          <div
                            key={`p2-${i}`}
                            className="size-10 sm:size-12 rounded-xl bg-card border-2 border-primary/40 font-mono font-black text-xl sm:text-2xl text-primary flex items-center justify-center shadow-sm"
                          >
                            {char}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyPairingCode}
                        className="text-xs gap-1.5"
                      >
                        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                        {copied ? '¡Copiado!' : `Copiar código (${session.pairingCode})`}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelPairingCode}
                        disabled={actionLoading}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cambiar número
                      </Button>
                    </div>

                    {/* Instrucciones de WhatsApp Móvil */}
                    <div className="p-4 rounded-xl bg-background/80 border border-border/60 text-left space-y-2.5">
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Smartphone className="size-4 text-primary" />
                        ¿Cómo ingresar el código en tu celular?
                      </p>
                      <ol className="space-y-2 text-xs text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="font-bold text-foreground">1.</span>
                          <span>Abre <strong>WhatsApp</strong> en tu teléfono.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="font-bold text-foreground">2.</span>
                          <span>Entra a <strong>Dispositivos vinculados</strong> y toca <strong>Vincular un dispositivo</strong>.</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="font-bold text-foreground">3.</span>
                          <span>
                            Toca en la parte inferior: <strong>&ldquo;Vincular con el número de teléfono&rdquo;</strong>.
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="font-bold text-foreground">4.</span>
                          <span>Ingresa el código de 8 caracteres mostrado arriba. ¡Listo!</span>
                        </li>
                      </ol>
                    </div>
                  </div>
                ) : isInitializing ? (
                  <div className="text-center py-10 space-y-3">
                    <Loader2 className="size-8 animate-spin text-primary mx-auto" />
                    <h4 className="font-semibold text-sm text-foreground">
                      Generando código de vinculación...
                    </h4>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Comunicándose con WhatsApp Web para solicitar tu código de 8 dígitos.
                    </p>
                  </div>
                ) : (
                  /* ─── FORMULARIO DE TELÉFONO ─── */
                  <div className="p-6 rounded-2xl border border-border/80 bg-muted/20 space-y-5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <KeyRound className="size-4 text-emerald-500" />
                        <h4 className="font-bold text-sm text-foreground">
                          Vincular directamente con tu número
                        </h4>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Ideal si no tienes otra pantalla para escanear el QR o prefieres recibir el código directamente en tu WhatsApp.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="pairing-phone" className="text-xs font-semibold">
                        Número de teléfono (con código de país)
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="pairing-phone"
                          type="tel"
                          value={pairingPhone}
                          onChange={(e) => setPairingPhone(e.target.value)}
                          placeholder="Ej: +54 9 11 2345 6789 o +52 1 55..."
                          className="text-sm bg-background font-mono"
                          disabled={actionLoading || !canEditSettings}
                        />
                        <Button
                          onClick={handleRequestPairingCode}
                          disabled={actionLoading || !canEditSettings || !pairingPhone.trim()}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 text-xs font-semibold gap-1.5"
                        >
                          {actionLoading ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <ArrowRight className="size-3.5" />
                          )}
                          Solicitar Código
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        No incluyas guiones ni espacios. Ejemplo Argentina: <code className="text-primary">54911xxxxxxxx</code> · México: <code className="text-primary">521xxxxxxxxxx</code> · España: <code className="text-primary">346xxxxxxxx</code>
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-card border border-border/50 text-xs text-muted-foreground space-y-1">
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        <ShieldCheck className="size-3.5 text-emerald-500" />
                        Vinculación oficial y segura
                      </div>
                      <p className="text-[11px]">
                        WhatsApp te enviará una notificación a tu celular para confirmar la vinculación una vez que introduzcas el código.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
