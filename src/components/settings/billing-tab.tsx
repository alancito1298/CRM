'use client';

import { useState, useEffect } from 'react';
import {
  Check,
  Zap,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  TrendingUp,
  Users,
  MessageSquare,
  Workflow,
  ArrowRight,
  Loader2,
  CreditCard,
  Building,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import type { Plan, AccountPlanDetails, PlanSlug } from '@/types/saas';
import { STATIC_PLANS } from '@/lib/saas/plans';

export function BillingTab() {
  const [loading, setLoading] = useState(true);
  const [updatingSlug, setUpdatingSlug] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [subscription, setSubscription] = useState<AccountPlanDetails | null>(null);
  const [plans, setPlans] = useState<Plan[]>(STATIC_PLANS);

  const loadSubscription = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/saas/subscription');
      if (res.ok) {
        const data = await res.json();
        if (data.subscription) {
          setSubscription(data.subscription);
        }
        if (data.plans && data.plans.length > 0) {
          setPlans(data.plans);
        }
      }
    } catch (err) {
      console.error('Error loading subscription:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubscription();
  }, []);

  const handleSelectPlan = async (slug: PlanSlug) => {
    if (subscription?.plan_slug === slug) return;

    try {
      setUpdatingSlug(slug);
      const res = await fetch('/api/saas/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_slug: slug }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al actualizar el plan');
      }

      toast.success(data.message || `Plan cambiado a ${slug.toUpperCase()} con éxito`);
      await loadSubscription();
    } catch (err: any) {
      toast.error(err.message || 'No se pudo cambiar el plan');
    } finally {
      setUpdatingSlug(null);
    }
  };

  const currentSlug = subscription?.plan_slug || 'free';

  // Calculos de progreso
  const messagesLimit = subscription?.max_messages_per_month || 300;
  const messagesUsed = subscription?.messages_used_this_month || 0;
  const messagesPct = Math.min(100, Math.round((messagesUsed / messagesLimit) * 100));

  const contactsLimit = subscription?.max_contacts || 500;
  const contactsUsed = subscription?.contacts_count || 0;
  const contactsPct = Math.min(100, Math.round((contactsUsed / contactsLimit) * 100));

  const agentsLimit = subscription?.max_agents || 1;
  const agentsUsed = subscription?.agents_count || 1;
  const agentsPct = Math.min(100, Math.round((agentsUsed / agentsLimit) * 100));

  return (
    <div className="space-y-8">
      <SettingsPanelHead
        title="Planes y Facturación"
        description="Gestiona tu suscripción, límites de uso mensual y opciones de escalabilidad para tu empresa."
      />

      {/* ─── RESUMEN DE SUSCRIPCIÓN ACTUAL ─── */}
      <Card className="border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 shadow-sm overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-emerald-500 to-indigo-500" />
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <CardTitle className="text-xl font-bold">Plan Actual</CardTitle>
              <Badge
                variant="outline"
                className="bg-primary/10 text-primary border-primary/30 uppercase tracking-wide font-semibold text-xs px-2.5 py-0.5"
              >
                {subscription?.plan_name || 'Gratuito'}
              </Badge>
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs px-2"
              >
                ● Activo
              </Badge>
            </div>
            <CardDescription className="mt-1">
              {currentSlug === 'free'
                ? 'Estás utilizando la versión gratuita de bienvenida con límites iniciales.'
                : 'Tu empresa cuenta con acceso a funciones avanzadas y mayor capacidad.'}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const el = document.getElementById('pricing-grid');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <TrendingUp className="size-4 text-primary" />
              Cambiar de Plan
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-2 pb-6 border-t border-border/50">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Consumo en el período actual
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Mensajes WhatsApp */}
            <div className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                  <MessageSquare className="size-4 text-emerald-500" />
                  Mensajes de WhatsApp
                </span>
                <span className="font-semibold text-foreground text-xs">
                  {messagesUsed.toLocaleString()} / {messagesLimit > 900000 ? 'Ilimitado' : messagesLimit.toLocaleString()}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${messagesLimit > 900000 ? 5 : messagesPct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {messagesLimit > 900000 ? 'Sin límite mensual' : `${messagesPct}% consumido este mes`}
              </p>
            </div>

            {/* Contactos */}
            <div className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                  <Users className="size-4 text-indigo-500" />
                  Contactos guardados
                </span>
                <span className="font-semibold text-foreground text-xs">
                  {contactsUsed.toLocaleString()} / {contactsLimit > 900000 ? 'Ilimitado' : contactsLimit.toLocaleString()}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${contactsLimit > 900000 ? 5 : contactsPct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {contactsLimit > 900000 ? 'Capacidad ilimitada' : `${contactsPct}% de tu capacidad máxima`}
              </p>
            </div>

            {/* Agentes de equipo */}
            <div className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                  <Building className="size-4 text-amber-500" />
                  Agentes / Usuarios
                </span>
                <span className="font-semibold text-foreground text-xs">
                  {agentsUsed} / {agentsLimit > 900000 ? 'Ilimitado' : agentsLimit}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500"
                  style={{ width: `${agentsLimit > 900000 ? 10 : agentsPct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {agentsLimit > 900000 ? 'Asientos sin límite' : `${agentsUsed} de ${agentsLimit} asientos en uso`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── SELECCIÓN DE PLANES DISPONIBLES ─── */}
      <div id="pricing-grid" className="space-y-6 pt-4">
        <div className="text-center space-y-3 max-w-xl mx-auto">
          <h3 className="text-2xl font-bold tracking-tight text-foreground">
            Escala tu negocio con el plan ideal
          </h3>
          <p className="text-sm text-muted-foreground">
            Todos los planes incluyen conexión de WhatsApp Web multidispositivo, bandeja compartida y CRM centralizado.
          </p>

          {/* Toggle Mensual / Anual */}
          <div className="inline-flex items-center gap-1 p-1 bg-muted rounded-full border border-border/60 mt-2">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Facturación Mensual
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('yearly')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors flex items-center gap-1.5 ${
                billingCycle === 'yearly'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Facturación Anual
              <span className="text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded-full">
                -20% OFF
              </span>
            </button>
          </div>
        </div>

        {/* Tarjetas de Planes */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
          {plans.map((p) => {
            const isCurrent = currentSlug === p.slug;
            const isPro = p.slug === 'pro';
            const price = billingCycle === 'monthly' ? p.price_monthly_usd : Math.round(p.price_yearly_usd / 12);
            const isUpgrading = updatingSlug === p.slug;

            return (
              <div
                key={p.slug}
                className={`relative flex flex-col rounded-2xl border transition-all duration-200 ${
                  isCurrent
                    ? 'border-primary shadow-md bg-card ring-1 ring-primary/30'
                    : isPro
                    ? 'border-primary/50 shadow-sm bg-card hover:border-primary/80 hover:shadow-md'
                    : 'border-border/70 bg-card/60 hover:border-border hover:bg-card'
                }`}
              >
                {isPro && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-indigo-600 text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                    <Sparkles className="size-3" /> Más Popular
                  </div>
                )}

                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                    <Check className="size-3" /> Plan Actual
                  </div>
                )}

                <div className="p-5 flex-1 space-y-4">
                  <div>
                    <h4 className="font-bold text-lg text-foreground">{p.name}</h4>
                    <p className="text-xs text-muted-foreground mt-1 min-h-[32px]">{p.description}</p>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-foreground">
                      ${price}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      USD / mes
                    </span>
                  </div>

                  <div className="pt-2 border-t border-border/50 space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Check className="size-3.5 text-emerald-500 shrink-0" />
                      <span>
                        <strong>{p.max_messages_per_month > 900000 ? 'Ilimitados' : p.max_messages_per_month.toLocaleString()}</strong> mensajes/mes
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Check className="size-3.5 text-emerald-500 shrink-0" />
                      <span>
                        Hasta <strong>{p.max_contacts > 900000 ? 'Ilimitados' : p.max_contacts.toLocaleString()}</strong> contactos
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Check className="size-3.5 text-emerald-500 shrink-0" />
                      <span>
                        <strong>{p.max_agents > 900000 ? 'Ilimitados' : p.max_agents}</strong> {p.max_agents === 1 ? 'agente' : 'agentes'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {p.feature_ai_reply ? (
                        <Check className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <span className="size-3.5 text-muted-foreground/40 shrink-0 font-mono text-center">✕</span>
                      )}
                      <span className={p.feature_ai_reply ? 'text-foreground font-medium' : 'text-muted-foreground/70'}>
                        Respuesta automática con IA
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {p.feature_broadcasts ? (
                        <Check className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <span className="size-3.5 text-muted-foreground/40 shrink-0 font-mono text-center">✕</span>
                      )}
                      <span className={p.feature_broadcasts ? 'text-foreground' : 'text-muted-foreground/70'}>
                        Difusiones masivas
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {p.feature_flows ? (
                        <Check className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <span className="size-3.5 text-muted-foreground/40 shrink-0 font-mono text-center">✕</span>
                      )}
                      <span className={p.feature_flows ? 'text-foreground' : 'text-muted-foreground/70'}>
                        Automatizaciones y flujos
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-5 pt-0">
                  <Button
                    className={`w-full text-xs font-semibold ${
                      isCurrent
                        ? 'bg-muted text-muted-foreground hover:bg-muted cursor-default'
                        : isPro
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                    disabled={isCurrent || isUpgrading}
                    onClick={() => handleSelectPlan(p.slug)}
                  >
                    {isUpgrading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : isCurrent ? (
                      'Plan Actual'
                    ) : (
                      'Seleccionar Plan'
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
