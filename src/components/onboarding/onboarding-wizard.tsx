'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Building,
  Smartphone,
  Bot,
  Users,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

export function OnboardingWizard() {
  const router = useRouter();
  const { account, accountId, isOwner, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [businessName, setBusinessName] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!accountId) return;

    // Comprobar si ya vio el onboarding
    const key = `saas_onboarding_done_${accountId}`;
    const completed = localStorage.getItem(key);

    if (!completed) {
      setOpen(true);
      if (account?.name) {
        setBusinessName(account.name);
      }
    }
  }, [accountId, account]);

  const handleFinish = async () => {
    if (accountId) {
      localStorage.setItem(`saas_onboarding_done_${accountId}`, 'true');
      try {
        await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: true, companyName: businessName }),
        });
      } catch (err) {
        console.warn('Could not sync onboarding completion to backend:', err);
      }
    }
    setOpen(false);
    toast.success('¡Bienvenido a bordo! Tu espacio de trabajo está listo.');
  };

  const handleSaveBusinessName = async () => {
    if (!businessName.trim()) {
      setStep(2);
      return;
    }

    try {
      setSavingName(true);
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: businessName.trim() }),
      });

      if (res.ok) {
        await refreshProfile();
      }
    } catch (err) {
      console.warn('Could not save business name:', err);
    } finally {
      setSavingName(false);
      setStep(2);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleFinish()}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden border-border/80 bg-card">
        {/* Banner superior con gradiente */}
        <div className="bg-gradient-to-r from-primary via-indigo-600 to-emerald-500 p-6 text-white relative">
          <button
            type="button"
            onClick={handleFinish}
            className="absolute top-4 right-4 size-7 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors text-white/90"
          >
            <X className="size-4" />
          </button>
          <div className="flex items-center gap-2 mb-2">
            <span className="size-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
              {step}/4
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-white/80">
              Guía de inicio rápido SaaS
            </span>
          </div>
          <DialogTitle className="text-xl font-bold text-white">
            {step === 1 && 'Configura tu Negocio'}
            {step === 2 && 'Conecta tu WhatsApp'}
            {step === 3 && 'Activa tu Asistente IA'}
            {step === 4 && '¡Todo Listo para Crecer!'}
          </DialogTitle>
          <DialogDescription className="text-xs text-white/90 mt-1">
            {step === 1 && 'Personaliza el nombre de tu empresa o marca.'}
            {step === 2 && 'Cada usuario conecta su propio número de forma independiente.'}
            {step === 3 && 'Configura tu agente para responder a tus clientes 24/7.'}
            {step === 4 && 'Tu plataforma centralizada ya está operativa.'}
          </DialogDescription>
        </div>

        {/* Contenido según el paso */}
        <div className="p-6 space-y-6">
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="biz-name" className="text-xs font-semibold">
                  Nombre de tu Empresa o Proyecto
                </Label>
                <div className="relative">
                  <Building className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="biz-name"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Ej. Mi Tienda Online, Agencia Digital..."
                    className="pl-9 text-sm"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Este nombre identificará tu espacio de trabajo y tus cotizaciones.
                </p>
              </div>

              <div className="rounded-xl bg-muted/40 p-4 border border-border/60 flex items-start gap-3">
                <Sparkles className="size-5 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Como eres el creador de esta cuenta, tienes privilegios de <strong>Propietario</strong> para gestionar usuarios y planes.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
                <Smartphone className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <h4 className="font-semibold text-foreground">Conexión con Código QR directo</h4>
                  <p className="text-muted-foreground">
                    No necesitas aprobaciones complejas de Meta ni pagar tarifas por mensaje. Puedes conectar tu WhatsApp personal o Business escaneando un código QR en la sección de configuración.
                  </p>
                </div>
              </div>

              <div className="text-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleFinish();
                    router.push('/settings?tab=whatsapp');
                  }}
                  className="gap-2 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                >
                  <Smartphone className="size-4" />
                  Ir a Vincular WhatsApp Ahora
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
                <Bot className="size-5 text-indigo-500 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <h4 className="font-semibold text-foreground">Atención Automatizada con IA</h4>
                  <p className="text-muted-foreground">
                    Tu CRM incluye un motor inteligente de respuestas con Groq, Gemini y OpenAI que detecta saludos, preguntas de precios y ofrece soporte instantáneo a tus prospectos.
                  </p>
                </div>
              </div>

              <div className="text-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleFinish();
                    router.push('/agents');
                  }}
                  className="gap-2 text-xs border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
                >
                  <Bot className="size-4" />
                  Explorar Agente de IA
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4 text-center py-2">
              <div className="size-14 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-8" />
              </div>
              <h4 className="text-base font-bold text-foreground">
                ¡Tu CRM Multi-Tenant está listo!
              </h4>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Puedes invitar a tu equipo desde <strong>Ajustes &gt; Miembros</strong> y consultar los límites de tu plan en <strong>Planes y Facturación</strong>.
              </p>
            </div>
          )}
        </div>

        {/* Footer de navegación */}
        <div className="p-4 bg-muted/20 border-t border-border/50 flex items-center justify-between">
          {step > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => s - 1)}
              className="gap-1.5 text-xs text-muted-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Atrás
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFinish}
              className="text-xs text-muted-foreground"
            >
              Omitir guía
            </Button>
          )}

          {step < 4 ? (
            <Button
              size="sm"
              onClick={() => {
                if (step === 1) {
                  handleSaveBusinessName();
                } else {
                  setStep((s) => s + 1);
                }
              }}
              disabled={savingName}
              className="gap-1.5 text-xs"
            >
              {savingName ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <>
                  Siguiente
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleFinish}
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              Empezar Ahora
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
