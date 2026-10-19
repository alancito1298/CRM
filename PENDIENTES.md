# Pendientes del CRM

_Actualizado el 19 de octubre de 2026. Este archivo reemplaza la lista anterior; los casilleros sin marcar son trabajo pendiente._

## Estado comprobado

- [x] Fase 1a, proveedores de WhatsApp: hecha y commiteada antes de este trabajo.
- [x] Migraciones `043`, `044`, `045` y `046` aplicadas en Supabase (`dfxleljxqdfszhqdkacx`).
- [x] `SELECT count(*) FROM conversations WHERE channel_id IS NULL;` devolvió `0`.
- [x] Supabase Auth tiene el dominio `https://crm-phi-blue.vercel.app` y el patrón `https://crm-phi-blue.vercel.app/**` en Redirect URLs.
- [x] Meta tiene registrada `https://crm-phi-blue.vercel.app/api/instagram/callback` como URL de redirección.
- [x] M3 (OAuth, callback, tokens cifrados, webhook firmado, DMs y panel de conexión), M4 (filtro por canal, ventana de 24 h, identidades y unión de contactos) y correcciones de seguridad implementadas **localmente**.
- [x] Páginas `/privacy` y `/data-deletion` redactadas localmente con Cesar Di Leonardo y `dileodevsite@gmail.com`; el usuario aprobó ese texto para publicar.
- [x] `npm test`: 692 pruebas pasan. `npm run typecheck` y `npm run build` pasan. Las rutas públicas nuevas aparecen en el build.
- [x] Se pudo entrar al proyecto `crm` de Vercel con **Continuar con Google**. El login por email no entregó código; ya no hace falta para esta sesión.
- [x] Se envió la invitación a `ampet` como Evaluador de Instagram de la app Meta `CrmTest`.

**Importante:** el código de M1–M4, seguridad y páginas públicas sigue en el árbol de trabajo local, sin commit ni despliegue. La producción visible en Vercel corresponde al despliegue anterior (`3b49eda`, rama `cesar`). El proyecto de Vercel muestra la opción **Connect Git**, así que hay que confirmar cómo quedarán vinculados los despliegues futuros.

## 1. Cerrar M1 y M2 con WhatsApp real

**Bloqueo:** el usuario confirmó que no tiene ninguna cuenta de WhatsApp conectada ahora. Las 692 pruebas automatizadas no sustituyen esta prueba de extremo a extremo.

- [ ] Conectar una cuenta de WhatsApp de prueba en Ajustes: QR para WA Web o una cuenta de Meta/Twilio configurada.
- [ ] Recibir un mensaje nuevo y verificar que aparece en el inbox y dispara el bot o la IA según configuración.
- [ ] Responder desde el inbox con texto, imagen, plantilla y cita de un mensaje.
- [ ] Probar un flow con botones de punta a punta y una reacción enviada desde el teléfono.
- [ ] Verificar que no se crean conversaciones duplicadas y repetir la consulta de `channel_id IS NULL`.
- [ ] Corregir cualquier fallo encontrado. Solo si todo pasa, commitear M1 y M2. No se hizo ese commit todavía.

## 2. Desplegar y probar Instagram (M3) y la interfaz (M4)

### Vercel y Meta

- [ ] **Verificar** si `INSTAGRAM_APP_ID` quedó guardado en el proyecto `crm` de Vercel para Production. Se completó y envió el formulario con `1655248082945198`, pero la interrupción impidió comprobar la lista final.
- [ ] Cargar `INSTAGRAM_APP_SECRET` como Secret de Production. Existe en `.env.local`; no copiar su valor al repositorio ni a este documento.
- [ ] Generar y cargar `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` en Vercel; usar el mismo valor en la configuración del webhook de Meta. Todavía no existe en `.env.local`.
- [ ] Confirmar que las demás variables necesarias para las nuevas rutas están disponibles en Production, especialmente `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_SITE_URL`.
- [ ] Definir y ejecutar el despliegue de la versión local al proyecto `crm` (Git conectado o CLI), y comprobar `/api/instagram/callback`, `/privacy` y `/data-deletion` en `crm-phi-blue.vercel.app`. Las páginas públicas ya tienen aprobación del usuario, pero aún no están publicadas.
- [ ] En Meta, cargar las URLs públicas de política de privacidad y eliminación de datos, el correo de contacto, categoría e ícono requeridos. Confirmar que Meta las acepta.
- [ ] `ampet` debe **aceptar** la invitación de Evaluador de Instagram desde Instagram → Apps y sitios web. Meta la muestra como **Pendiente**.
- [ ] Conectar una cuenta profesional de Instagram desde Ajustes y verificar OAuth, guardado/renovación de token y estado conectado.
- [ ] Publicar/configurar el webhook de Instagram en Meta cuando la app lo permita. Verificar el desafío y un DM entrante real.
- [ ] Enviar un DM de texto y un medio desde el inbox; comprobar filtro por canal, ventana de 24 h, reacción entrante y que las funciones no admitidas estén ocultas.
- [ ] Probar unión de dos contactos con identidades de canales distintos, incluidos historial y permisos. La migración 046 está aplicada, pero esta operación no se probó en vivo.
- [ ] Preparar video de demostración y completar App Review de Meta para `instagram_business_manage_messages` y los demás permisos que pida la app. Sin aprobación, las cuentas ajenas a los roles de prueba no podrán usar la integración.

### Instagram: mejoras después de la primera prueba

- [x] Guardar el ID profesional (`/me?fields=user_id`) en vez del ID de OAuth; sin esto los webhooks se descartan. Hay que reconectar la cuenta una vez.
- [ ] Botón **Desconectar**: canal a `disconnected`, borrar token, conservar historial. Marcar desconectado también si el usuario quita la app desde Instagram.
- [x] Prueba real 19/10: DM entrante llega al inbox y la respuesta sale desde el CRM.
- [ ] Suscribir la cuenta al webhook automáticamente al conectar (`POST /{ig-user-id}/subscribed_apps`); hoy se activó a mano en Meta.
- [ ] Nombre del contacto: pedir `name`/`username`/foto del IGSID a la API; hoy muestra el número.
- [ ] Inbox: el contador "23h remaining" se superpone con un ícono; el aviso "WhatsApp is not connected" aparece aunque haya Instagram conectado.
- [ ] Mostrar `@usuario` en vez del ID numérico en Ajustes.
- [ ] Varias cuentas por CRM: migración que quite el único `idx_instagram_connections_account`, callback que agregue en vez de reemplazar, lista de cuentas en Ajustes, cuenta de entrada visible en el inbox y límite por plan en `plans.ts`.

### Revisión antes del despliegue

- [ ] Revisar el contenido de la versión completa que se subirá: incluye M1–M4, seguridad y páginas públicas. El build local pasa, pero las integraciones aún no tienen pruebas reales.
- [ ] Evitar que la interfaz prometa capacidades de Instagram sin prueba real; comprobar tipos de medios, respuestas citadas y reacciones con la API efectiva.

## 3. Terminar M5 sin perder mensajes

- [ ] Pasar las entradas de WA Web en `whatsapp-service.mjs` por `ingestInbound` y eliminar la lógica duplicada de guardado, IA y automatizaciones.
- [ ] Hacer que todos los escritores de conversaciones asignen `channel_id` e identidad de forma explícita. Verificar importación histórica y mensajes salientes.
- [ ] Cambiar las llamadas y el nombre de `/api/whatsapp/send` a una ruta multicanal, manteniendo compatibilidad mientras se migra la interfaz.
- [ ] Repetir las pruebas reales de WhatsApp e Instagram. **Después** quitar los triggers provisorios de la migración 043 con una migración nueva. No borrarlos mientras WA Web escriba directo en la base.

## 4. Seguridad: validar en los proveedores reales

Los cambios de código ya están hechos localmente: firma de Twilio, cuenta y número destinatario explícitos, avisos de IA a número configurado, eliminación de números fijos y de `scratch_update_natural_prompt.mjs`, y `account_members` reemplazada por `profiles`.

- [ ] Configurar `TWILIO_ACCOUNT_ID`, token y número receptor si se usará Twilio; probar firma válida/inválida y número no reconocido contra el webhook real.
- [ ] Probar que los avisos de IA solo salen al número configurado para esa cuenta y que no cruzan cuentas.
- [ ] Probar permisos de unión de contactos y aislamiento entre cuentas en Supabase.
- [ ] Revisar la firma y el manejo de reintentos de los webhooks de Meta/Instagram con eventos reales; las pruebas locales no prueban su entrega.

## 5. Fase 1b: BullMQ, Redis y workers

**Bloqueo de infraestructura:** no hay URL de Redis ni servidor/worker persistente contratado o configurado. `docker-compose.yml` solo contiene la app; Docker no estaba disponible en esta máquina durante la revisión.

- [ ] Elegir y configurar Redis accesible para la app y el worker, más el VPS/servicio donde correrá el proceso persistente.
- [ ] Añadir BullMQ, colas, workers, reintentos, idempotencia, observabilidad y apagado ordenado.
- [ ] Pasar difusiones, respuestas de IA y automatizaciones a la cola sin duplicar envíos.
- [ ] Configurar disparadores para tareas programadas (`/api/automations/cron` y `/api/flows/cron`), que actualmente no se ejecutan solos; validar autenticación y frecuencia.
- [ ] Probar recuperación tras caída, reintentos y límites por canal antes de activar en producción.

## 6. Fases 2 a 4

- [ ] **Fase 2:** capa de servicios/repositorios para sacar consultas directas a Supabase de las vistas, contratos por cuenta/canal y validación con Zod.
- [ ] **Fase 3:** dividir `automation-builder`, `message-thread`, `template-manager`, `node-config-form` y las páginas grandes de contactos e inbox; probar cada extracción.
- [ ] **Fase 4:** corregir lint y dejar verde el CI que **ya existe**. Última ejecución: 35 errores y 69 advertencias; tests, typecheck y build sí pasan.
- [ ] Añadir pruebas de integración para webhooks, unión de contactos, workers y permisos entre cuentas; configurar Sentry y sus variables de entorno.
- [ ] Revisar y actualizar dependencias con vulnerabilidades, en especial la cadena de `whatsapp-web.js`, sin romper el servicio.
- [ ] Antes de ofrecer el producto a clientes: configurar SMTP propio en Supabase, sacar Google OAuth del modo de prueba y comprobar login/confirmación en producción.

## Criterio de cierre

El plan queda terminado cuando hay pruebas reales de WhatsApp e Instagram, M5 sin triggers temporales, cola y tareas programadas operativas, CI verde, monitoreo activo y despliegue verificado. Hasta entonces, no marcar como terminadas las integraciones por el solo hecho de que compiló el código.
