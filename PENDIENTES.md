# Estado del proyecto y pendientes

_Última actualización: 2026-10-16_

## Objetivo
Profesionalizar **wacrm** (CRM de WhatsApp open source modificado por terceros) para venderlo a muchos clientes: desacoplado, escalable y con componentes reutilizables.

**Stack:** Next.js 16 + React 19 + Supabase (Postgres, Auth y Realtime) + servicio aparte de WhatsApp Web (`whatsapp-service.mjs`).

---

## Plan de 4 fases

| Fase | Qué | Estado |
|---|---|---|
| **1a** | Interfaz común de proveedores de WhatsApp (Meta / Twilio / WA Web) | ✅ Hecha, **falta probar y commitear** |
| **1b** | Cola de tareas BullMQ + Redis y workers en Docker | ⏳ Siguiente |
| **2** | Capa de servicios/repositorios: las vistas dejan de consultar Supabase directo. Validación con Zod | Pendiente |
| **3** | Partir componentes gigantes (`automation-builder`, `message-thread`, `template-manager`, `node-config-form`, páginas de contactos e inbox) | Pendiente |
| **4** | Tests en lo crítico, CI, Sentry y actualización de dependencias | Pendiente |

**Decisiones tomadas**
- WA Web queda como un proveedor más. Meta Cloud API es el proveedor recomendado para clientes que pagan.
- Despliegue en **VPS con Docker**, por eso la cola es **BullMQ + Redis**.
- Se avanza **fase por fase**: se prueba cada una antes de seguir.

---

## Lo que se hizo hoy

**Rama:** `refactor/whatsapp-providers`. **Todavía sin commitear.**

### Fase 1a: proveedores de WhatsApp
- `src/lib/whatsapp/providers/` tiene la interfaz común y un proveedor por canal: `meta.ts`, `twilio.ts`, `wa-web.ts`.
- `resolve.ts` es el **único lugar** que decide el proveedor de cada cuenta: WA Web (si hay sesión) → Meta → Twilio.
- `src/lib/whatsapp/bot-send.ts` concentra el envío y guardado de mensajes de Flows, Automations y la IA.
- Se eliminaron unas 1.100 líneas duplicadas en 6 archivos.
- **Bugs corregidos:**
  - Twilio pisaba a Meta para todas las cuentas.
  - Las plantillas llegaban como `[Plantilla: x]` por WA Web.
  - Los mensajes con botones salían vacíos.
  - Flows no guardaba la URL de los medios.
- **Seguridad:** el servicio de WA Web no tenía autenticación. Ahora exige `WA_SERVICE_TOKEN` (ya configurado y probado).
- 11 tests nuevos en `providers.test.ts`.

### Entorno local
- Supabase creado (proyecto `dfxleljxqdfszhqdkacx`) y `setup_database.sql` corrido sin errores.
- Errores corregidos en el SQL:
  - La migración 041 estaba cortada.
  - La 042 usaba la tabla inexistente `account_members`. Se cambió por `profiles`.
- `.env.local` completo (está en `.gitignore`).
- Se instalaron las dependencias con `npm ci`.

### Login con Google
- Botón reutilizable `src/components/auth/google-sign-in-button.tsx`, en login y en registro.
- Funciona con Supabase Auth. **No usa Firebase.**
- Credencial creada en Google Cloud y cargada en Supabase. La app de Google está en **modo prueba**.
- `client_secret*.json` agregado al `.gitignore`.

### Registro seguro
- Antes se creaban usuarios con el email "verificado" sin confirmar. Eso permitía robar cuentas al unirse con Google.
  - Ahora usa `supabase.auth.signUp()`, que manda un **email de confirmación**.
- El plan lo elegía el navegador, así que se podía tener Pro gratis. **Ahora siempre arranca en Gratuito.**
- El botón "Probar Demo" queda **apagado**. Se prende con `NEXT_PUBLIC_ENABLE_DEMO_SIGNUP=true`.

---

## ▶️ Para retomar mañana (en orden)

### 1. Configuraciones pendientes en paneles
- [ ] **Supabase → Authentication → URL Configuration → Redirect URLs:** `http://localhost:3000/**`
- [ ] **Google Cloud → Pantalla de consentimiento / Público → Usuarios de prueba:** agregar `cesardileo18@gmail.com`

### 2. Probar
Levantar la app con `npm run dev` y el servicio de WhatsApp con `npm run whatsapp`.

- [ ] Login con Google en http://localhost:3000/login
- [ ] Registro con email: llega el correo de confirmación (solo funciona con tu email hasta configurar SMTP)
- [ ] Conectar WhatsApp por QR en *Ajustes → WhatsApp*
- [ ] Mensaje manual desde la bandeja: texto, imagen y plantilla
- [ ] Flow con botones
- [ ] Envío masivo chico, de 2 o 3 contactos
- [ ] Si todo anda: **commit de la fase 1a**

### 3. Arreglos de seguridad recomendados (cambios chicos)
- [ ] **La IA elige a quién mandar los avisos.** En `whatsapp-service.mjs:407` el número que recibe el resumen de "pedido cerrado" lo escribe la IA en su respuesta. Un cliente podría hacer que se envíen datos a otro número. El número tiene que salir solo de la configuración de la cuenta.
- [ ] **Borrar `scratch_update_natural_prompt.mjs`.** Si se ejecuta, pisa la configuración de IA de **todas** las cuentas.
- [ ] **Números fijos en la IA** (`whatsapp-service.mjs:238`): `1168863090` y `3445416457`. La IA solo les responde a ellos si no está `AI_TEST_PHONE_ONLY`. Si la variable no está definida, debería responder a todos.
- [ ] `src/lib/saas/plans.ts` y `src/app/api/admin/tenants/route.ts` usan la tabla inexistente `account_members`. Rompe el conteo de agentes para los límites del plan. Cambiar por `profiles`.

### 4. Después: fase 1b
Cola BullMQ + Redis y workers en `docker-compose` para:
- envíos masivos;
- automatizaciones;
- respuestas de la IA;
- tareas programadas (`/api/automations/cron` y `/api/flows/cron`), que hoy nada las dispara.

---

## Revisión de código malicioso
**No se encontró código malicioso.** No hay exfiltración de datos ni dominios desconocidos, `eval` o código ofuscado, scripts de instalación ni claves hardcodeadas. Las dependencias son conocidas.

Riesgos encontrados (no maliciosos): los de la sección 3, más:
- Los links de invitación caen en `wacrm.tech` si falta `NEXT_PUBLIC_SITE_URL`. En producción hay que poner tu dominio.
- 31 vulnerabilidades conocidas en dependencias internas (2 críticas y 25 altas), sobre todo por `whatsapp-web.js`. Queda para la fase 4.

---

## Configuración y credenciales

**Ya configurado en `.env.local`:**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`, `WA_SERVICE_TOKEN`, `AUTOMATION_CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, `NEXT_PUBLIC_APP_LOCALE=es`, `WHATSAPP_TEMPLATES_DRY_RUN=true`
- `META_APP_SECRET`: tiene un valor provisorio. Reemplazar cuando se configure Meta.

**Opcionales, según la función:**

| Para qué | Qué | Dónde |
|---|---|---|
| API oficial de WhatsApp | `META_APP_SECRET`, `META_APP_ID` y una URL pública para el webhook (ngrok en local) | developers.facebook.com |
| Cobros | `MP_ACCESS_TOKEN` | mercadopago.com → Tus integraciones |
| Notificaciones | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | @BotFather |
| Emails a cualquier usuario (producción) | SMTP en el panel de Supabase | resend.com (gratis) |
| IA | No va en el `.env` | Cada cuenta la carga en *Ajustes → IA* |

**Cómo se conecta WhatsApp:**
- **QR (WA Web):** sin token y gratis, pero no es oficial: hay riesgo de baneo y no escala.
- **API de Meta:** cada cliente carga su Access Token, Phone Number ID y WABA ID en *Ajustes → WhatsApp*.

## Ideas para más adelante
- **Instagram:** no existe en el proyecto. Se haría con la API oficial de Meta (cuenta profesional, permiso `instagram_manage_messages` y aprobación de Meta), como un proveedor más sobre la interfaz de la fase 1a.
- Antes de vender: pasar la app de Google a producción y configurar SMTP propio.
