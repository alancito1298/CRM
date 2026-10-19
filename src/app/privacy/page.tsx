import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description: 'Información sobre el tratamiento de datos del CRM.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12 text-sm leading-7">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">Política de privacidad</h1>
        <p>Última actualización: 19 de octubre de 2026</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Responsable y contacto</h2>
        <p>Cesar Di Leonardo es el responsable de este CRM. Para consultas sobre privacidad, escribí a <a className="underline" href="mailto:dileodevsite@gmail.com">dileodevsite@gmail.com</a>.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Datos que tratamos</h2>
        <p>Cuando usás el CRM, podemos tratar datos de cuenta y perfil, contactos, identificadores de WhatsApp e Instagram, conversaciones, archivos enviados, configuraciones, registros de actividad e información necesaria para conectar los canales.</p>
        <p>Los mensajes que envíes a una cuenta conectada pueden quedar registrados en el CRM para que esa cuenta pueda responder y gestionar la conversación.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Para qué usamos los datos</h2>
        <p>Usamos estos datos para autenticar usuarios, conectar canales, recibir y enviar mensajes, mostrar el historial, organizar contactos, ejecutar funciones configuradas por la cuenta y proteger el servicio. Si la cuenta activa funciones de inteligencia artificial, el contenido necesario para esa función puede procesarse mediante el proveedor que configure.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Servicios externos</h2>
        <p>El CRM usa Supabase para autenticación y almacenamiento, Vercel para alojar la aplicación y los servicios de Meta para las conexiones de Instagram y WhatsApp que se activen. Una cuenta también puede configurar otros proveedores de mensajería o de inteligencia artificial; en ese caso se comparten con ellos los datos necesarios para prestar esa función.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Conservación y seguridad</h2>
        <p>Conservamos los datos mientras sean necesarios para prestar el servicio, administrar la cuenta y atender obligaciones aplicables. Las solicitudes de eliminación se revisan según el alcance de la cuenta y las obligaciones de conservación. Aplicamos controles de acceso por cuenta y protegemos las credenciales de conexión.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Tus solicitudes</h2>
        <p>Podés pedir acceso, corrección o eliminación de tus datos escribiendo a <a className="underline" href="mailto:dileodevsite@gmail.com?subject=Solicitud%20de%20privacidad">dileodevsite@gmail.com</a>. Incluí el canal y la cuenta involucrados para que podamos ubicar la información. Podemos pedir datos adicionales para verificar la identidad antes de actuar.</p>
        <p>Consultá también <a className="underline" href="/data-deletion">cómo solicitar la eliminación de datos</a>.</p>
      </section>
    </main>
  );
}
