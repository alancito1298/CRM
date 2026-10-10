'use client';

import { useState, useEffect } from 'react';
import {
  Sparkles,
  Bot,
  Building,
  Check,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  HelpCircle,
  ShieldAlert,
  Send,
  Loader2,
  CheckCircle2,
  Sliders,
  DollarSign,
  UserCheck,
  FileText,
  KeyRound,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  type OnboardingQuestionnaireData,
  DEFAULT_QUESTIONNAIRE_DATA,
  generateSystemPromptFromQuestionnaire,
} from '@/types/onboarding';

interface AiOnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STEPS = [
  { id: 1, title: 'Identidad y Tono', icon: Building, desc: 'Nombre, propósito y estilo de voz' },
  { id: 2, title: 'Servicios y Precios', icon: DollarSign, desc: 'Productos, cotizaciones y pagos' },
  { id: 3, title: 'Filtro y Reglas', icon: UserCheck, desc: 'Datos del cliente y servicios excluidos' },
  { id: 4, title: 'Preguntas Frecuentes', icon: HelpCircle, desc: 'Respuestas a consultas típicas y horarios' },
  { id: 5, title: 'Derivación y Límites', icon: ShieldAlert, desc: 'Traspaso a humanos y prohibiciones' },
  { id: 6, title: 'Revisión y Activación', icon: Sparkles, desc: 'Vista previa del prompt y proveedor' },
];

export function AiOnboardingModal({ open, onOpenChange, onSuccess }: AiOnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<OnboardingQuestionnaireData>(DEFAULT_QUESTIONNAIRE_DATA);
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [aiAlreadyConfigured, setAiAlreadyConfigured] = useState(false);

  // Cargar datos previos si existen
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/onboarding/questionnaire');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.answers) {
            setFormData(data.answers);
            setAiAlreadyConfigured(data.aiConfigured || false);
          }
        }
      } catch (err) {
        console.warn('Error loading questionnaire data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Actualizar la vista previa del prompt al llegar al paso 6
  useEffect(() => {
    if (currentStep === 6) {
      setPreviewPrompt(generateSystemPromptFromQuestionnaire(formData));
    }
  }, [currentStep, formData]);

  const updateField = <K extends keyof OnboardingQuestionnaireData>(field: K, value: OnboardingQuestionnaireData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleTone = (tone: 'cordial' | 'formal' | 'commercial') => {
    setFormData((prev) => {
      const exists = prev.toneStyle.includes(tone);
      const updated = exists ? prev.toneStyle.filter((t) => t !== tone) : [...prev.toneStyle, tone];
      return { ...prev, toneStyle: updated.length ? updated : ['cordial'] };
    });
  };

  const toggleLeadField = (field: string) => {
    setFormData((prev) => {
      const exists = prev.requiredLeadFields.includes(field);
      const updated = exists
        ? prev.requiredLeadFields.filter((f) => f !== field)
        : [...prev.requiredLeadFields, field];
      return { ...prev, requiredLeadFields: updated };
    });
  };

  const handleAddFaq = () => {
    setFormData((prev) => ({
      ...prev,
      faqs: [...prev.faqs, { question: '', answer: '' }],
    }));
  };

  const handleUpdateFaq = (index: number, key: 'question' | 'answer', val: string) => {
    setFormData((prev) => {
      const list = [...prev.faqs];
      list[index] = { ...list[index], [key]: val };
      return { ...prev, faqs: list };
    });
  };

  const handleRemoveFaq = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      faqs: prev.faqs.filter((_, i) => i !== index),
    }));
  };

  const handleSaveAndTrain = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/onboarding/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al guardar el cuestionario');
      }

      toast.success(data.message || '¡Asistente entrenado exitosamente!');
      onSuccess?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'No se pudo guardar la configuración');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 overflow-hidden max-h-[90vh] flex flex-col border-border/80 bg-card">
        {/* Cabecera con gradiente y pasos */}
        <div className="bg-gradient-to-r from-primary via-indigo-600 to-emerald-600 p-5 text-white shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Bot className="size-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-white">
                  Entrenamiento y Personalización del Asistente IA
                </DialogTitle>
                <DialogDescription className="text-xs text-white/80">
                  Cuestionario oficial para configurar el comportamiento y conocimiento de tu agente de WhatsApp
                </DialogDescription>
              </div>
            </div>
            <Badge variant="outline" className="border-white/30 text-white bg-white/10 text-xs">
              Paso {currentStep} de {STEPS.length}
            </Badge>
          </div>

          {/* Stepper horizontal */}
          <div className="grid grid-cols-6 gap-1.5 mt-4 pt-2 border-t border-white/20">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const isActive = currentStep === s.id;
              const isPast = currentStep > s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCurrentStep(s.id)}
                  className={`flex flex-col items-center gap-1 text-center py-1 rounded transition-colors ${
                    isActive
                      ? 'bg-white/25 text-white font-semibold'
                      : isPast
                      ? 'text-white/90 hover:bg-white/10'
                      : 'text-white/60 hover:bg-white/5'
                  }`}
                >
                  <Icon className="size-3.5" />
                  <span className="text-[10px] hidden sm:inline leading-none truncate max-w-full px-1">
                    {s.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Contenedor con scroll de contenido */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-xs">Cargando cuestionario de onboarding...</p>
            </div>
          ) : (
            <>
              {/* ─── PASO 1: IDENTIDAD Y TONO ─── */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="biz-name" className="text-xs font-semibold">
                      1.1. Nombre de tu empresa o marca comercial
                    </Label>
                    <Input
                      id="biz-name"
                      value={formData.businessName}
                      onChange={(e) => updateField('businessName', e.target.value)}
                      placeholder="Ej: Innova Digital, Tienda Moda, Consultora Álvarez..."
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="biz-desc" className="text-xs font-semibold">
                      1.2. ¿A qué se dedican y qué problema principal resuelven a sus clientes?
                    </Label>
                    <Textarea
                      id="biz-desc"
                      rows={3}
                      value={formData.businessDescription}
                      onChange={(e) => updateField('businessDescription', e.target.value)}
                      placeholder="Ej: Vendemos calzado deportivo de alta gama y asesoramos a corredores para evitar lesiones con el calzado ideal."
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">
                      1.3. ¿Cómo debe hablar y expresarse tu asistente de IA?
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'cordial', label: 'Cercano & Cordial', hint: 'Emojis moderados y trato cálido' },
                        { id: 'formal', label: 'Corporativo & Formal', hint: 'Directo, sobrio y profesional' },
                        { id: 'commercial', label: 'Comercial & Dinámico', hint: 'Orientado a ventas y persuasivo' },
                      ].map((t) => {
                        const active = formData.toneStyle.includes(t.id as any);
                        return (
                          <div
                            key={t.id}
                            onClick={() => toggleTone(t.id as any)}
                            className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                              active
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border/70 hover:bg-muted/40 text-muted-foreground'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs font-bold text-foreground">
                              {t.label}
                              {active && <Check className="size-3.5 text-primary" />}
                            </div>
                            <p className="text-[11px] mt-0.5 opacity-80">{t.hint}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Forma de tratamiento</Label>
                      <Select
                        value={formData.treatment}
                        onValueChange={(val: any) => updateField('treatment', val)}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tu">Tuteo estándar ("Tú tienes", "Avísame")</SelectItem>
                          <SelectItem value="vos">Voseo rioplatense ("Vos tenés", "Escribime")</SelectItem>
                          <SelectItem value="usted">Formal de respeto ("Usted tiene", "Avísenos")</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Identificación de la IA</Label>
                      <Select
                        value={formData.assistantPersona}
                        onValueChange={(val: any) => updateField('assistantPersona', val)}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bot">Asistente Virtual (Bot inteligente)</SelectItem>
                          <SelectItem value="agent">Asesor del equipo de atención</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="persona-phrase" className="text-xs font-semibold">
                      Frase o nombre de presentación (Opcional)
                    </Label>
                    <Input
                      id="persona-phrase"
                      value={formData.personaCustomPhrase || ''}
                      onChange={(e) => updateField('personaCustomPhrase', e.target.value)}
                      placeholder='Ej: "Soy Sofía, asistente virtual de Innova" o "Soy del equipo de atención"'
                      className="text-sm"
                    />
                  </div>
                </div>
              )}

              {/* ─── PASO 2: SERVICIOS Y PRECIOS ─── */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="products" className="text-xs font-semibold">
                      2.1. Lista tus 3 a 5 productos o servicios principales
                    </Label>
                    <Textarea
                      id="products"
                      rows={3}
                      value={formData.mainProducts}
                      onChange={(e) => updateField('mainProducts', e.target.value)}
                      placeholder="1. Consultoría SEO y Posicionamiento Web ($250/mes)&#10;2. Desarrollo de Tiendas Online Shopify ($800)&#10;3. Gestión de Publicidad en Meta Ads ($400/mes)"
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">2.2. ¿Cómo manejan los precios?</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'fixed', label: 'Precios fijos', desc: 'La IA puede informar precios directamente' },
                        { id: 'custom', label: 'Presupuestos a medida', desc: 'Requiere pedir detalles previos al cliente' },
                        { id: 'both', label: 'Mixto', desc: 'Precios de lista + servicios a medida' },
                      ].map((p) => {
                        const active = formData.pricingPolicy === p.id;
                        return (
                          <div
                            key={p.id}
                            onClick={() => updateField('pricingPolicy', p.id as any)}
                            className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                              active
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border/70 hover:bg-muted/40 text-muted-foreground'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs font-bold text-foreground">
                              {p.label}
                              {active && <Check className="size-3.5 text-primary" />}
                            </div>
                            <p className="text-[11px] mt-0.5 opacity-80">{p.desc}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {formData.pricingPolicy !== 'fixed' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="quote-req" className="text-xs font-semibold">
                        2.3. Para cotizar a medida, ¿qué datos debe solicitar el bot?
                      </Label>
                      <Input
                        id="quote-req"
                        value={formData.customQuoteRequirements || ''}
                        onChange={(e) => updateField('customQuoteRequirements', e.target.value)}
                        placeholder="Ej: Cantidad de unidades, medidas, localidad de entrega, rubro o fecha límite."
                        className="text-sm"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="payments" className="text-xs font-semibold">
                      2.4. Métodos de pago y promociones vigentes
                    </Label>
                    <Input
                      id="payments"
                      value={formData.paymentMethods}
                      onChange={(e) => updateField('paymentMethods', e.target.value)}
                      placeholder="Ej: Transferencia bancaria, tarjetas de crédito, 3 cuotas sin interés, 10% off en efectivo."
                      className="text-sm"
                    />
                  </div>
                </div>
              )}

              {/* ─── PASO 3: FILTRO Y REGLAS ─── */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">
                      3.1. ¿Qué datos de contacto debe recopilar el bot del interesado?
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      La IA solicitará estos datos de manera natural antes de transferir o cerrar el prospecto:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'name', label: 'Nombre y Apellido' },
                        { id: 'city', label: 'Ciudad / Localidad' },
                        { id: 'email', label: 'Correo Electrónico' },
                        { id: 'company', label: 'Nombre de su Empresa' },
                        { id: 'urgency', label: 'Urgencia / Fecha' },
                        { id: 'alt_phone', label: 'Teléfono alternativo' },
                      ].map((field) => {
                        const active = formData.requiredLeadFields.includes(field.id);
                        return (
                          <div
                            key={field.id}
                            onClick={() => toggleLeadField(field.id)}
                            className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                              active
                                ? 'border-primary bg-primary/10 text-primary font-semibold'
                                : 'border-border/70 hover:bg-muted/40 text-muted-foreground'
                            }`}
                          >
                            <span>{field.label}</span>
                            {active && <Check className="size-3.5 text-primary" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <Label htmlFor="excluded" className="text-xs font-semibold">
                      3.2. ¿Qué servicios o productos NO ofrecen? (Para que el bot descarte cordialmente)
                    </Label>
                    <Textarea
                      id="excluded"
                      rows={3}
                      value={formData.excludedServices}
                      onChange={(e) => updateField('excludedServices', e.target.value)}
                      placeholder="Ej: No realizamos impresiones físicas, no reparamos equipos usados, no atendemos emergencias 24hs."
                      className="text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Si un prospecto consulta por esto, la IA le explicará cordialmente que la empresa no presta ese servicio.
                    </p>
                  </div>
                </div>
              )}

              {/* ─── PASO 4: FAQS Y HORARIOS ─── */}
              {currentStep === 4 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-semibold">
                        4.1. Preguntas más comunes por WhatsApp (FAQs)
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        La IA responderá estas dudas al instante con exactitud.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddFaq}
                      className="gap-1.5 text-xs h-7"
                    >
                      <Plus className="size-3.5" />
                      Agregar Pregunta
                    </Button>
                  </div>

                  <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                    {formData.faqs.map((faq, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-border/70 p-3 bg-muted/20 space-y-2 relative group"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Input
                            placeholder={`Pregunta #${idx + 1}`}
                            value={faq.question}
                            onChange={(e) => handleUpdateFaq(idx, 'question', e.target.value)}
                            className="text-xs h-8 font-semibold bg-background"
                          />
                          {formData.faqs.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveFaq(idx)}
                              className="size-7 p-0 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                        <Textarea
                          placeholder="Respuesta que debe dar la IA..."
                          rows={2}
                          value={faq.answer}
                          onChange={(e) => handleUpdateFaq(idx, 'answer', e.target.value)}
                          className="text-xs bg-background"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <Label htmlFor="hours" className="text-xs font-semibold">
                      4.2. Ubicación física, envíos y horarios de atención
                    </Label>
                    <Input
                      id="hours"
                      value={formData.locationAndHours}
                      onChange={(e) => updateField('locationAndHours', e.target.value)}
                      placeholder="Ej: Lunes a Viernes de 9 a 18 hs. Oficinas en Palermo, CABA. Envíos a todo el país vía Andreani."
                      className="text-sm"
                    />
                  </div>
                </div>
              )}

              {/* ─── PASO 5: DERIVACIÓN Y LÍMITES ─── */}
              {currentStep === 5 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      5.1. ¿Cuál es el objetivo principal del chat?
                    </Label>
                    <Select
                      value={formData.chatGoal}
                      onValueChange={(val: any) => updateField('chatGoal', val)}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="transfer_sales">Calificar y derivar a un asesor de ventas</SelectItem>
                        <SelectItem value="schedule_call">Agendar una llamada / reunión de demostración</SelectItem>
                        <SelectItem value="buy_link">Guiar hacia enlace de compra o pago directo</SelectItem>
                        <SelectItem value="send_catalog">Informar y compartir catálogo de productos</SelectItem>
                        <SelectItem value="other">Resolver dudas y brindar soporte general</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="handoff" className="text-xs font-semibold">
                      5.2. ¿En qué momento exacto debe pausarse la IA y transferir a una persona?
                    </Label>
                    <Textarea
                      id="handoff"
                      rows={2}
                      value={formData.handoffTrigger}
                      onChange={(e) => updateField('handoffTrigger', e.target.value)}
                      placeholder="Ej: Cuando el cliente pida hablar con alguien, confirme el pedido, tenga una queja o consulte casos complejos."
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="unknown" className="text-xs font-semibold">
                      5.3. ¿Qué debe responder la IA cuando no tiene la información exacta?
                    </Label>
                    <Input
                      id="unknown"
                      value={formData.unknownQueryResponse}
                      onChange={(e) => updateField('unknownQueryResponse', e.target.value)}
                      placeholder="Ej: Para brindarte una respuesta confirmada, un asesor se comunicará por este mismo chat a la brevedad."
                      className="text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground italic">
                      Regla de oro: nunca inventar datos ni condiciones.
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="prohibitions" className="text-xs font-semibold text-destructive/90 flex items-center gap-1.5">
                      <ShieldAlert className="size-3.5 text-destructive" />
                      5.4. Límites estrictos (Lo que la IA NUNCA debe decir o hacer)
                    </Label>
                    <Textarea
                      id="prohibitions"
                      rows={2}
                      value={formData.strictProhibitions}
                      onChange={(e) => updateField('strictProhibitions', e.target.value)}
                      placeholder="Ej: Nunca prometer rebajas sin autorización. Nunca confirmar plazos de entrega exactos sin stock confirmado."
                      className="text-sm border-destructive/30"
                    />
                  </div>
                </div>
              )}

              {/* ─── PASO 6: REVISIÓN Y ACTIVACIÓN ─── */}
              {currentStep === 6 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-start gap-3">
                    <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <h4 className="font-semibold text-foreground">¡Cuestionario completado con éxito!</h4>
                      <p className="text-muted-foreground">
                        Hemos sintetizado un <strong>Prompt Maestro optimizado para WhatsApp</strong> y preparado documentos para la Base de Conocimiento de tu empresa.
                      </p>
                    </div>
                  </div>

                  {/* Vista previa del Prompt generado */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold flex items-center gap-1.5">
                        <FileText className="size-3.5 text-primary" />
                        Prompt del Sistema Generado Automáticamente
                      </Label>
                      <span className="text-[11px] text-muted-foreground">
                        {previewPrompt.length} caracteres
                      </span>
                    </div>
                    <Textarea
                      readOnly
                      rows={6}
                      value={previewPrompt}
                      className="font-mono text-xs bg-muted/40 leading-relaxed text-foreground select-all"
                    />
                  </div>

                  {/* Configuración rápida de Proveedor y API Key */}
                  <div className="rounded-lg border border-border/80 bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound className="size-4 text-primary" />
                        <h4 className="text-xs font-bold text-foreground">Proveedor de IA para WhatsApp</h4>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {aiAlreadyConfigured ? 'Clave ya configurada' : 'Requiere Clave'}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Proveedor</Label>
                        <Select
                          value={formData.provider || 'groq'}
                          onValueChange={(val: any) => {
                            updateField('provider', val);
                            if (val === 'groq') updateField('model', 'llama-3.1-8b-instant');
                            if (val === 'openai') updateField('model', 'gpt-4o-mini');
                            if (val === 'gemini') updateField('model', 'gemini-1.5-flash');
                          }}
                        >
                          <SelectTrigger className="text-xs h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="groq">Groq (Ultra Rápido - Gratis)</SelectItem>
                            <SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>
                            <SelectItem value="gemini">Google Gemini</SelectItem>
                            <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px]">API Key del Proveedor</Label>
                        <Input
                          type="password"
                          placeholder={aiAlreadyConfigured ? '•••••••••••••••• (dejar vacío para mantener)' : 'gsk_... / sk-...'}
                          value={formData.apiKey || ''}
                          onChange={(e) => updateField('apiKey', e.target.value)}
                          className="text-xs h-8 font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
                      <span>¿No tienes clave? Puedes obtener una gratuita en Groq:</span>
                      <a
                        href="https://console.groq.com/keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
                      >
                        console.groq.com <ExternalLink className="size-3" />
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer de navegación */}
        <div className="p-4 bg-muted/20 border-t border-border/50 flex items-center justify-between shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={currentStep === 1 || saving}
            onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
            className="gap-1.5 text-xs text-muted-foreground"
          >
            <ChevronLeft className="size-4" />
            Anterior
          </Button>

          <div className="flex items-center gap-2">
            {currentStep < 6 ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCurrentStep((s) => Math.min(6, s + 1))}
                className="gap-1.5 text-xs"
              >
                Siguiente
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={handleSaveAndTrain}
                className="gap-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Entrenando Asistente...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Guardar y Entrenar IA
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
