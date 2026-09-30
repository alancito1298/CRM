'use client';

import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Building,
  Users,
  CreditCard,
  MessageSquare,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import type { PlanSlug } from '@/types/saas';

interface Tenant {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  plan_slug: PlanSlug;
  plan_name: string;
  status: string;
  messages_used: number;
  created_at: string;
}

interface AdminStats {
  total_tenants: number;
  total_users: number;
  total_contacts: number;
  paid_subscriptions: number;
}

export default function AdminPage() {
  const { isOwner, profileLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/tenants');
      if (!res.ok) {
        throw new Error('Error al cargar datos del panel de administración');
      }
      const data = await res.json();
      setTenants(data.tenants || []);
      setStats(data.stats || null);
    } catch (err: any) {
      toast.error(err.message || 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleChangePlan = async (accountId: string, newSlug: PlanSlug) => {
    try {
      setUpdatingId(accountId);
      const res = await fetch('/api/admin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, plan_slug: newSlug }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al cambiar plan');
      }

      toast.success(data.message || 'Plan actualizado');
      setTenants((prev) =>
        prev.map((t) =>
          t.id === accountId
            ? { ...t, plan_slug: newSlug, plan_name: newSlug.toUpperCase() }
            : t
        )
      );
    } catch (err: any) {
      toast.error(err.message || 'No se pudo actualizar el plan');
    } finally {
      setUpdatingId(null);
    }
  };

  if (!profileLoading && !isOwner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
          <ShieldAlert className="size-8" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Acceso Restringido</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Este panel está reservado exclusivamente para los administradores de la plataforma SaaS.
        </p>
      </div>
    );
  }

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.owner_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.owner_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Panel Super Admin SaaS
            </h1>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs">
              Centralizado
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Control global de cuentas registradas, asignación de planes y estado general del sistema.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="gap-2 shrink-0 text-xs"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refrescar datos
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Empresas / Cuentas
              </p>
              <p className="text-2xl font-black text-foreground">
                {stats?.total_tenants ?? tenants.length}
              </p>
            </div>
            <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Building className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Usuarios Registrados
              </p>
              <p className="text-2xl font-black text-foreground">
                {stats?.total_users ?? 0}
              </p>
            </div>
            <div className="size-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Contactos Totales
              </p>
              <p className="text-2xl font-black text-foreground">
                {stats?.total_contacts ?? 0}
              </p>
            </div>
            <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <MessageSquare className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/70 shadow-sm">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Suscripciones de Pago
              </p>
              <p className="text-2xl font-black text-emerald-500">
                {stats?.paid_subscriptions ?? 0}
              </p>
            </div>
            <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CreditCard className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Tenants */}
      <Card className="border border-border/70 shadow-sm overflow-hidden">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/50">
          <div>
            <CardTitle className="text-lg font-bold">Listado de Tenants</CardTitle>
            <CardDescription className="text-xs">
              Todas las organizaciones registradas en la plataforma y su nivel de suscripción.
            </CardDescription>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por empresa o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 text-xs h-9"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-sm">Cargando empresas registradas...</span>
            </div>
          ) : filteredTenants.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground space-y-2">
              <Building className="size-8 mx-auto opacity-40" />
              <p className="text-sm">No se encontraron cuentas que coincidan con la búsqueda.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-muted-foreground font-semibold">
                    <th className="py-3 px-4">Empresa / Cuenta</th>
                    <th className="py-3 px-4">Propietario</th>
                    <th className="py-3 px-4">Plan Actual</th>
                    <th className="py-3 px-4">Mensajes Usados</th>
                    <th className="py-3 px-4">Fecha de Alta</th>
                    <th className="py-3 px-4 text-right">Asignar Plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredTenants.map((t) => {
                    const isUpdating = updatingId === t.id;
                    const isFree = t.plan_slug === 'free';
                    const isPro = t.plan_slug === 'pro';
                    const isStarter = t.plan_slug === 'starter';
                    const isEnterprise = t.plan_slug === 'enterprise';

                    return (
                      <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-foreground text-sm">{t.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{t.id}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="text-foreground font-medium">{t.owner_name}</div>
                          <div className="text-muted-foreground">{t.owner_email}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <Badge
                            variant="outline"
                            className={`font-semibold uppercase tracking-wider text-[10px] px-2 py-0.5 ${
                              isPro
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : isEnterprise
                                ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/30'
                                : isStarter
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                : 'bg-muted text-muted-foreground border-border'
                            }`}
                          >
                            {t.plan_name}
                          </Badge>
                        </td>

                        <td className="py-3.5 px-4 text-foreground font-medium">
                          {t.messages_used.toLocaleString()}
                        </td>

                        <td className="py-3.5 px-4 text-muted-foreground">
                          {new Date(t.created_at).toLocaleDateString('es-ES', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {isUpdating ? (
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            ) : (
                              <select
                                value={t.plan_slug}
                                onChange={(e) => handleChangePlan(t.id, e.target.value as PlanSlug)}
                                className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                              >
                                <option value="free">Free</option>
                                <option value="starter">Starter</option>
                                <option value="pro">Pro</option>
                                <option value="enterprise">Enterprise</option>
                              </select>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
