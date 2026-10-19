import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Eliminación de datos',
  description: 'Cómo solicitar la eliminación de datos del CRM.',
};

export default function DataDeletionPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12 text-sm leading-7">
      <h1 className="text-3xl font-semibold">Solicitar la eliminación de datos</h1>
      <p>Si querés eliminar datos asociados con una cuenta de Instagram, WhatsApp o del CRM, enviá un correo a <a className="underline" href="mailto:dileodevsite@gmail.com?subject=Eliminaci%C3%B3n%20de%20datos">dileodevsite@gmail.com</a>.</p>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Qué incluir</h2>
        <p>Indicá la cuenta o canal involucrado, el identificador con el que interactuaste y qué datos querés eliminar. No envíes contraseñas ni códigos de acceso. Podremos solicitar información adicional para comprobar que la solicitud corresponde a tus datos.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Qué ocurre después</h2>
        <p>Confirmaremos la recepción, revisaremos la identidad y el alcance de la solicitud y eliminaremos o desidentificaremos los datos que corresponda. Te informaremos si alguna información debe conservarse por una obligación aplicable o si pertenece a una cuenta administrada por otra persona.</p>
        <p>También podés revocar el acceso de la aplicación desde las opciones de aplicaciones y sitios web de tu cuenta de Instagram. La revocación detiene el acceso futuro, pero para pedir la eliminación de datos ya guardados debés enviar la solicitud indicada arriba.</p>
      </section>
      <p>Consultá la <a className="underline" href="/privacy">política de privacidad</a> para más información.</p>
    </main>
  );
}
