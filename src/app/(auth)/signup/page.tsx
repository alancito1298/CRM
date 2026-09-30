'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  MessageSquare,
  Building,
  User,
  Mail,
  Lock,
  Sparkles,
  CheckCircle2,
  Zap,
  ArrowRight,
  Loader2,
  ShieldCheck,
  Bot,
  PlayCircle,
  Eye,
  EyeOff,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [planSlug, setPlanSlug] = useState<'free' | 'starter' | 'pro'>('free');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError('Por favor ingresa tu nombre');
      return;
    }

    if (!companyName.trim()) {
      setError('Por favor ingresa el nombre de tu empresa o negocio');
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          companyName,
          email,
          password,
          planSlug,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al crear la cuenta');
      }

      toast.success('¡Cuenta creada con éxito! Iniciando sesión...');

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        toast.info('Cuenta lista. Por favor ingresa tus credenciales para acceder.');
        router.push('/login');
        return;
      }

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Error inesperado al registrarte');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = async () => {
    setDemoLoading(true);
    setError(null);
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const demoEmail = `demo.usuario${randomNum}@wacrm.test`;
    const demoPassword = 'Password123!';
    const demoName = `Usuario Demo ${randomNum}`;
    const demoCompany = `Empresa Demo ${randomNum}`;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: demoName,
          companyName: demoCompany,
          email: demoEmail,
          password: demoPassword,
          planSlug: 'starter',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error creando usuario de prueba');

      toast.success('¡Usuario demo generado! Accediendo al sistema...');

      await supabase.auth.signInWithPassword({
        email: demoEmail,
        password: demoPassword,
      });

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-background text-foreground">
      {/* ─── HEADER EXCLUSIVO PARA MOBILE Y TABLET (< lg) ─── */}
      <div className="lg:hidden w-full border-b border-border/60 bg-card/60 backdrop-blur-md px-5 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl bg-gradient-to-tr from-primary to-emerald-500 flex items-center justify-center text-white shadow-md shadow-primary/20">
            <MessageSquare className="size-5" />
          </div>
          <div>
            <span className="font-black text-base tracking-tight text-foreground">WACRM</span>
            <span className="text-[10px] ml-1.5 font-bold text-primary uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded-full border border-primary/20">
              SaaS
            </span>
          </div>
        </div>

        <Link
          href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : '/login'}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Iniciar sesión
        </Link>
      </div>

      {/* ─── COLUMNA IZQUIERDA: Propuesta de valor & Demo interactiva (Desktop lg+) ─── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-5/12 bg-gradient-to-br from-card via-background to-muted/40 p-10 xl:p-14 flex-col justify-between border-r border-border/60 relative overflow-hidden">
        {/* Luces difuminadas de fondo */}
        <div className="absolute top-1/6 left-1/6 size-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/6 size-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top: Logo y Marca */}
        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-2xl bg-gradient-to-tr from-primary to-emerald-500 flex items-center justify-center text-white shadow-lg shadow-primary/20">
              <MessageSquare className="size-6" />
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-foreground">
                WACRM
              </span>
              <span className="text-xs ml-2 font-semibold text-primary uppercase tracking-widest bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                SaaS Multi-Tenant
              </span>
            </div>
          </div>

          <div className="pt-2 space-y-3">
            <h1 className="text-3xl xl:text-4xl font-black tracking-tight text-foreground leading-[1.2]">
              Tu WhatsApp, CRM e IA centralizados en un{' '}
              <span className="bg-gradient-to-r from-primary via-emerald-500 to-indigo-500 bg-clip-text text-transparent">
                solo software.
              </span>
            </h1>
            <p className="text-sm xl:text-base text-muted-foreground leading-relaxed max-w-md">
              Permite que tu empresa atienda a cientos de prospectos en automático, asigne conversaciones a tu equipo y cierre ventas 24/7.
            </p>
          </div>

          {/* Tarjeta Visual Demo de Chat con IA */}
          <div className="rounded-2xl border border-border/80 bg-card/70 p-4 shadow-sm backdrop-blur-sm space-y-3 max-w-md">
            <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="size-7 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold text-xs">
                  WA
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">Asistente IA • Tu Negocio</p>
                  <p className="text-[10px] text-emerald-500 font-medium">● En línea (24/7)</p>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                Auto-Reply
              </Badge>
            </div>

            <div className="space-y-2 text-xs">
              <div className="bg-muted/60 p-2.5 rounded-xl rounded-tl-none max-w-[85%] text-foreground">
                Hola, ¿tienen stock del producto y qué medios de pago aceptan?
              </div>
              <div className="bg-primary/10 border border-primary/20 p-2.5 rounded-xl rounded-tr-none ml-auto max-w-[88%] text-foreground">
                ¡Hola! Sí, tenemos stock disponible. Aceptamos transferencias y tarjetas en cuotas sin interés. ¿De qué ciudad nos escribes para coordinar tu envío? 😊
              </div>
            </div>
          </div>

          {/* Viñetas destacadas */}
          <div className="space-y-3 pt-2 max-w-md">
            <div className="flex items-center gap-3 text-xs text-foreground">
              <div className="size-6 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                <CheckCircle2 className="size-3.5" />
              </div>
              <span><strong>Conexión con QR directo:</strong> Sin tarifas por mensaje ni trámites con Meta.</span>
            </div>

            <div className="flex items-center gap-3 text-xs text-foreground">
              <div className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bot className="size-3.5" />
              </div>
              <span><strong>IA inteligente entrenada:</strong> Responde con Groq, OpenAI o Gemini.</span>
            </div>

            <div className="flex items-center gap-3 text-xs text-foreground">
              <div className="size-6 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                <ShieldCheck className="size-3.5" />
              </div>
              <span><strong>Privacidad garantizada:</strong> Cada empresa tiene sus datos 100% aislados.</span>
            </div>
          </div>
        </div>

        {/* Footer desktop */}
        <div className="pt-6 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground relative z-10">
          <span>✓ Prueba gratuita de 14 días</span>
          <span>✓ Sin tarjeta de crédito</span>
          <span>✓ Cancelas cuando quieras</span>
        </div>
      </div>

      {/* ─── COLUMNA DERECHA: Formulario de Registro Responsive ─── */}
      <div className="flex-1 flex flex-col justify-center items-center px-4 py-8 sm:px-8 lg:px-12 xl:px-16 overflow-y-auto">
        <div className="w-full max-w-md space-y-6 my-auto">
          {/* Encabezado del Formulario */}
          <div className="space-y-2 text-left">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs">
                Nuevo Espacio de Trabajo
              </Badge>
              <span className="text-[11px] text-muted-foreground">• Configuración en 1 minuto</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Crea tu cuenta de empresa
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Ingresa los datos de tu negocio para activar tu CRM con WhatsApp y tu asistente de IA.
            </p>
          </div>

          {/* Banner de Acceso Rápido Demo (1 clic) */}
          <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-emerald-500/10 to-indigo-500/10 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary shrink-0" />
                ¿Quieres probar el sistema ya mismo?
              </p>
              <p className="text-[11px] text-muted-foreground">
                Crea una cuenta de demostración automática con un solo clic.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleQuickDemo}
              disabled={demoLoading || loading}
              className="text-xs font-semibold gap-1.5 shrink-0 border-primary/40 text-primary hover:bg-primary/10 h-8 self-start sm:self-auto"
            >
              {demoLoading ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
              Probar Demo
            </Button>
          </div>

          {/* Alerta de Error si ocurre */}
          {error && (
            <div className="p-3 text-xs bg-destructive/10 border border-destructive/30 text-destructive rounded-xl font-medium animate-in fade-in-50">
              {error}
            </div>
          )}

          {/* Formulario */}
          <form onSubmit={handleSignup} className="space-y-4">
            {/* Campo: Nombre Completo */}
            <div className="space-y-1.5">
              <Label htmlFor="fullName" className="text-xs font-semibold text-foreground">
                Tu Nombre Completo
              </Label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  placeholder="Ej. Juan Pérez"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="pl-10 text-xs sm:text-sm h-11 rounded-xl"
                  required
                />
              </div>
            </div>

            {/* Campo: Nombre de Empresa */}
            <div className="space-y-1.5">
              <Label htmlFor="companyName" className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Nombre de tu Empresa o Negocio</span>
                <span className="text-[10px] text-primary font-normal">Identificará tu cuenta</span>
              </Label>
              <div className="relative">
                <Building className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="companyName"
                  placeholder="Ej. Mi Tienda Online, Inmobiliaria..."
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="pl-10 text-xs sm:text-sm h-11 rounded-xl"
                  required
                />
              </div>
            </div>

            {/* Campo: Correo Electrónico */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold text-foreground">
                Correo Electrónico
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="juan@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 text-xs sm:text-sm h-11 rounded-xl"
                  required
                />
              </div>
            </div>

            {/* Campo: Contraseña con Toggle de visibilidad */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                Contraseña
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 text-xs sm:text-sm h-11 rounded-xl"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Selector de Plan Inicial (Responsive 3 columnas o stack en pantallas ultra pequeñas) */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground">Elige tu Plan inicial</Label>
                <span className="text-[10px] text-muted-foreground">Puedes cambiarlo luego</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {/* Plan Free */}
                <button
                  type="button"
                  onClick={() => setPlanSlug('free')}
                  className={`p-2.5 sm:p-3 rounded-xl border text-center transition-all ${
                    planSlug === 'free'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-xs'
                      : 'border-border/70 hover:border-border bg-card/60'
                  }`}
                >
                  <p className="text-xs font-bold text-foreground truncate">Gratuito</p>
                  <p className="text-[11px] font-semibold text-foreground mt-0.5">$0<span className="text-[9px] text-muted-foreground">/mes</span></p>
                  <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 block mt-1">
                    Básico
                  </span>
                </button>

                {/* Plan Starter */}
                <button
                  type="button"
                  onClick={() => setPlanSlug('starter')}
                  className={`p-2.5 sm:p-3 rounded-xl border text-center transition-all relative ${
                    planSlug === 'starter'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-xs'
                      : 'border-border/70 hover:border-border bg-card/60'
                  }`}
                >
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[8px] font-extrabold uppercase px-1.5 py-0.2 rounded-full">
                    Popular
                  </span>
                  <p className="text-xs font-bold text-foreground truncate">Starter</p>
                  <p className="text-[11px] font-semibold text-foreground mt-0.5">$29<span className="text-[9px] text-muted-foreground">/mes</span></p>
                  <span className="text-[9px] font-medium text-primary block mt-1">
                    Con IA
                  </span>
                </button>

                {/* Plan Pro */}
                <button
                  type="button"
                  onClick={() => setPlanSlug('pro')}
                  className={`p-2.5 sm:p-3 rounded-xl border text-center transition-all ${
                    planSlug === 'pro'
                      ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-xs'
                      : 'border-border/70 hover:border-border bg-card/60'
                  }`}
                >
                  <p className="text-xs font-bold text-foreground truncate">Pro</p>
                  <p className="text-[11px] font-semibold text-foreground mt-0.5">$79<span className="text-[9px] text-muted-foreground">/mes</span></p>
                  <span className="text-[9px] font-medium text-indigo-500 block mt-1">
                    Equipo
                  </span>
                </button>
              </div>
            </div>

            {/* Botón de Enviar */}
            <Button
              type="submit"
              disabled={loading || demoLoading}
              className="w-full text-xs sm:text-sm font-bold h-11 rounded-xl gap-2 bg-primary hover:bg-primary/90 mt-2 shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creando tu espacio de trabajo...
                </>
              ) : (
                <>
                  Comenzar ahora gratis
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          {/* Enlace para usuarios existentes */}
          <div className="text-center pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              ¿Ya tienes una cuenta registrada?{' '}
              <Link
                href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : '/login'}
                className="font-bold text-primary hover:underline"
              >
                Inicia sesión aquí
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
