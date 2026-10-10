'use client';

import { useEffect, useState } from 'react';
import { Bot, Sparkles, Settings2, BarChart3, Wand2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiConfig } from '@/components/settings/ai-config';
import { AiOnboardingModal } from '@/components/onboarding/ai-onboarding-modal';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'playground' | 'setup' | 'usage';

export default function AgentsPage() {
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('playground');
  const [decided, setDecided] = useState(false);
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);

  // Land first-time users on Setup, returning users on the Playground.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setTab(data?.configured ? 'playground' : 'setup');
      } catch {
        if (!cancelled) setTab('setup');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Agentes de IA
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Configura tu agente inteligente con tu propio proveedor (Groq, OpenAI, Claude o Gemini) y pruébalo en el área de pruebas antes de responder a clientes en WhatsApp.
          </p>
        </div>

        {canEdit && (
          <Button
            size="sm"
            onClick={() => setQuestionnaireOpen(true)}
            className="gap-2 bg-gradient-to-r from-indigo-600 via-primary to-emerald-600 hover:opacity-95 text-white shadow-sm shrink-0 font-medium"
          >
            <Sparkles className="size-4" />
            Cuestionario de Entrenamiento
          </Button>
        )}
      </div>

      <AiOnboardingModal
        open={questionnaireOpen}
        onOpenChange={setQuestionnaireOpen}
        onSuccess={() => {
          setTab('playground');
        }}
      />

      {decided && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="mt-6"
        >
          <TabsList>
            <TabsTrigger value="playground">
              <Sparkles className="mr-1.5 h-4 w-4" /> Área de pruebas
            </TabsTrigger>
            <TabsTrigger value="setup">
              <Settings2 className="mr-1.5 h-4 w-4" /> Configuración
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger value="usage">
                <BarChart3 className="mr-1.5 h-4 w-4" /> Consumo y tokens
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="playground" className="mt-4">
            <AiPlayground onGoToSetup={() => setTab('setup')} />
          </TabsContent>

          <TabsContent value="setup" className="mt-4">
            <AiConfig />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="usage" className="mt-4">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
