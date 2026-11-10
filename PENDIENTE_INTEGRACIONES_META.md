# Integraciones Meta: estado y próximos pasos

Actualizado: 19 de octubre de 2026. No incluir claves ni tokens en este archivo.

## Qué está publicado

- El CRM está en `https://crm-phi-blue.vercel.app/`.
- El botón **Conectar WhatsApp** usa la API oficial de Meta y no requiere Render. Su webhook está configurado en Meta y el evento `messages` está suscrito.
- La conexión antigua **WhatsApp Web por QR** sigue disponible como opción separada.
- En Meta, la app `CrmTest` tiene la configuración de registro insertado `CRM WhatsApp`. Para conectar clientes nuevos por la API oficial siguen pendientes la verificación del negocio, la revisión de la app y la verificación de acceso de Meta. Solo usuarios autorizados pueden probarla mientras tanto.

## WhatsApp Web por QR en Render

- Servicio creado en el plan **Free ($0/mes)**: `https://crm-whatsapp-qr.onrender.com/`.
- Panel: `https://dashboard.render.com/web/srv-dbb8831jfumc73esi17g`.
- Rama desplegada: `cesar`, commit `c64171d`.
- Render marcó el despliegue **Live**. La consulta autenticada a `/status` devolvió `service: running`; sin clave devolvió HTTP 401.
- Render tiene las cuatro variables necesarias: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` y `WA_SERVICE_TOKEN`. No copiar sus valores a este archivo.
- En Vercel Production se agregó `WA_SERVICE_URL=https://crm-whatsapp-qr.onrender.com` y se actualizó `WA_SERVICE_TOKEN` para eliminar un carácter invisible que causaba el error `Cannot convert argument to a ByteString`.
- **Prueba pendiente:** el primer intento de generar el QR desde el CRM falló por ese carácter invisible. Se inició un nuevo despliegue de Vercel después de corregirlo, pero el trabajo se pausó mientras figuraba `Building`. Antes de probar de nuevo, confirmar que ese despliegue terminó y que el alias de producción apunta a una versión lista.
- El archivo temporal usado para importar las variables a Render ya se eliminó.

## Cómo retomar la prueba del QR

1. Comprobar que el último despliegue de Vercel terminó correctamente. El anterior despliegue listo era `dpl_5UmXWFDqj4kKVzdaCoiwJ7UNiy9J`; el nuevo se inició justo antes de pausar.
2. Abrir `https://crm-phi-blue.vercel.app/settings?tab=whatsapp` e iniciar **WhatsApp Web Multidispositivo → Generar Código QR para Vincular**.
3. Confirmar que aparece el QR y que el servicio de Render registra una sesión. **No escanear ni vincular un teléfono sin que su dueño lo haga.**
4. Si falla, consultar la respuesta de `/api/whatsapp/service` desde la sesión del CRM y los registros de Render/Vercel. La clave de servicio en ambos despliegues debe coincidir; no mostrarla en logs ni mensajes.

## Límite importante del plan gratis

Render apaga los servicios Free tras 15 minutos sin tráfico y pierde los archivos locales al reiniciar. Este servicio usa `LocalAuth` de WhatsApp Web, por lo que la sesión del teléfono puede perderse y requerir otro QR. En Free sirve para pruebas, **no garantiza recepción continua de mensajes**. No pasar a un plan pago sin una decisión posterior del usuario.

## Reglas de mensajería conversadas

- Instagram en este CRM: se puede responder durante 24 horas desde el **último** mensaje del cliente. Cada mensaje nuevo reinicia el plazo. El CRM aún no implementa la excepción `HUMAN_AGENT` para respuestas manuales de atención hasta 7 días; requiere aprobación de Meta.
- WhatsApp por API: las 24 horas también se cuentan desde el **último** mensaje del cliente. Pasado ese plazo, se necesita una plantilla aprobada para escribirle desde el CRM. Los precios de Meta dependen del país y la categoría; revisar las tarifas vigentes antes de cotizar.
- WhatsApp Web por QR: no usa la facturación por mensajes de la API oficial, pero depende del servicio de Render.
