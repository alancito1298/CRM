import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Cuestionario de Onboarding — Asistente de IA</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

    @page {
      size: A4;
      margin: 15mm 15mm 15mm 15mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1e293b;
      background-color: #ffffff;
      font-size: 11pt;
      line-height: 1.5;
    }

    .header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 16px;
      margin-bottom: 22px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .header-text h1 {
      font-size: 19pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }

    .header-text p {
      font-size: 10pt;
      color: #64748b;
      max-width: 500px;
      line-height: 1.4;
    }

    .badge {
      background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);
      color: white;
      font-size: 8.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 6px 14px;
      border-radius: 9999px;
      display: inline-block;
      white-space: nowrap;
    }

    .intro-box {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #4f46e5;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 9.5pt;
      color: #475569;
    }

    .section {
      margin-bottom: 22px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 12pt;
      font-weight: 700;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #f1f5f9;
    }

    .section-number {
      background-color: #e0e7ff;
      color: #4338ca;
      font-size: 9pt;
      font-weight: 800;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .question {
      margin-bottom: 14px;
    }

    .question-title {
      font-weight: 600;
      font-size: 10pt;
      color: #334155;
      margin-bottom: 6px;
    }

    .question-hint {
      font-size: 8.5pt;
      color: #64748b;
      margin-top: -3px;
      margin-bottom: 6px;
      font-style: italic;
    }

    .answer-line {
      border-bottom: 1px dashed #cbd5e1;
      height: 24px;
      width: 100%;
      margin-bottom: 4px;
    }

    .answer-box {
      border: 1px solid #e2e8f0;
      background-color: #fafafa;
      border-radius: 6px;
      height: 52px;
      width: 100%;
    }

    .answer-box-lg {
      border: 1px solid #e2e8f0;
      background-color: #fafafa;
      border-radius: 6px;
      height: 75px;
      width: 100%;
    }

    .checkbox-group {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px 16px;
      margin-top: 4px;
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 9pt;
      color: #475569;
    }

    .checkbox-square {
      width: 13px;
      height: 13px;
      border: 1.5px solid #94a3b8;
      border-radius: 3px;
      display: inline-block;
      flex-shrink: 0;
    }

    .faq-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .faq-item {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 9pt;
    }

    .footer {
      text-align: center;
      font-size: 8pt;
      color: #94a3b8;
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
    }

    .page-break {
      page-break-before: always;
    }
  </style>
</head>
<body>

  <!-- ENCABEZADO -->
  <div class="header">
    <div class="header-text">
      <h1>Cuestionario de Onboarding</h1>
      <p>Entrenamiento y personalización del Asistente Virtual con Inteligencia Artificial (WhatsApp CRM).</p>
    </div>
    <div class="badge">CRM & AI Solutions</div>
  </div>

  <div class="intro-box">
    <strong>Objetivo:</strong> La información que completes en esta ficha nos permitirá configurar tu agente de IA para que responda con la identidad de tu empresa, conozca tus productos, resuelva dudas en segundos y derive prospectos calificados a tu equipo.
  </div>

  <!-- BLOQUE 1 -->
  <div class="section">
    <div class="section-title">
      <span class="section-number">1</span>
      Identidad del Negocio y Tono de Comunicación
    </div>

    <div class="question">
      <div class="question-title">1.1. Nombre de tu empresa o marca comercial:</div>
      <div class="answer-line"></div>
    </div>

    <div class="question">
      <div class="question-title">1.2. ¿A qué se dedican y qué problema principal resuelven a sus clientes?</div>
      <div class="answer-box"></div>
    </div>

    <div class="question">
      <div class="question-title">1.3. ¿Cómo debe hablar y expresarse tu asistente de IA?</div>
      <div class="checkbox-group">
        <div class="checkbox-item"><span class="checkbox-square"></span> Cercano, cordial y con emojis moderados</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Corporativo, formal y directo</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Dinámico, persuasivo y comercial</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Tratamiento: Tuteo ("Tú")</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Tratamiento: Voseo ("Vos")</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Tratamiento: Formal ("Usted")</div>
      </div>
    </div>

    <div class="question">
      <div class="question-title">1.4. ¿El asistente debe identificarse como Bot o como Asesor humano?</div>
      <div class="question-hint">Ej: "Soy Sofía, asistente virtual de [Empresa]" vs "Hola, soy del equipo de atención de [Empresa]".</div>
      <div class="answer-line"></div>
    </div>
  </div>

  <!-- BLOQUE 2 -->
  <div class="section">
    <div class="section-title">
      <span class="section-number">2</span>
      Servicios, Productos y Cotizaciones
    </div>

    <div class="question">
      <div class="question-title">2.1. Lista tus 3 a 5 productos o servicios principales:</div>
      <div class="answer-box-lg"></div>
    </div>

    <div class="question">
      <div class="question-title">2.2. ¿Cómo manejan los precios?</div>
      <div class="checkbox-group">
        <div class="checkbox-item"><span class="checkbox-square"></span> Precios fijos (La IA puede informarlos)</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Presupuestos personalizados a medida</div>
      </div>
    </div>

    <div class="question">
      <div class="question-title">2.3. Si cotizan a medida, ¿qué datos debe solicitar el bot para armar el presupuesto?</div>
      <div class="question-hint">Ej: cantidad, medidas, localidad, rubro, características específicas.</div>
      <div class="answer-line"></div>
      <div class="answer-line"></div>
    </div>

    <div class="question">
      <div class="question-title">2.4. Métodos de pago y promociones vigentes:</div>
      <div class="question-hint">Ej: Transferencia, tarjetas, cuotas sin interés, 10% off en efectivo.</div>
      <div class="answer-line"></div>
    </div>
  </div>

  <div class="page-break"></div>

  <!-- BLOQUE 3 -->
  <div class="section">
    <div class="section-title">
      <span class="section-number">3</span>
      Filtro de Prospectos y Reglas de Negocio
    </div>

    <div class="question">
      <div class="question-title">3.1. ¿Qué datos de contacto debe recopilar el bot del interesado?</div>
      <div class="checkbox-group">
        <div class="checkbox-item"><span class="checkbox-square"></span> Nombre y Apellido</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Ciudad / Localidad</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Correo Electrónico</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Nombre de su Empresa</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Urgencia / Fecha de inicio</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Teléfono alternativo</div>
      </div>
    </div>

    <div class="question">
      <div class="question-title">3.2. ¿Qué servicios o productos NO ofrecen? (Para que el bot descarte cordialmente):</div>
      <div class="answer-box"></div>
    </div>
  </div>

  <!-- BLOQUE 4 -->
  <div class="section">
    <div class="section-title">
      <span class="section-number">4</span>
      Preguntas Frecuentes (FAQ)
    </div>

    <div class="question">
      <div class="question-title">4.1. Indica las preguntas más comunes que te hacen por WhatsApp y su respuesta:</div>
      <div class="faq-grid">
        <div class="faq-item">
          <strong>P1:</strong> <span class="answer-line" style="display:inline-block; width:85%; margin-bottom:0;"></span><br>
          <strong>R:</strong> <span class="answer-line" style="display:inline-block; width:87%; margin-bottom:0;"></span>
        </div>
        <div class="faq-item">
          <strong>P2:</strong> <span class="answer-line" style="display:inline-block; width:85%; margin-bottom:0;"></span><br>
          <strong>R:</strong> <span class="answer-line" style="display:inline-block; width:87%; margin-bottom:0;"></span>
        </div>
        <div class="faq-item">
          <strong>P3:</strong> <span class="answer-line" style="display:inline-block; width:85%; margin-bottom:0;"></span><br>
          <strong>R:</strong> <span class="answer-line" style="display:inline-block; width:87%; margin-bottom:0;"></span>
        </div>
      </div>
    </div>

    <div class="question">
      <div class="question-title">4.2. Ubicación física / Envíos y Horarios de atención:</div>
      <div class="answer-line"></div>
    </div>
  </div>

  <!-- BLOQUE 5 -->
  <div class="section">
    <div class="section-title">
      <span class="section-number">5</span>
      Derivación Humana y Reglas de Cierre
    </div>

    <div class="question">
      <div class="question-title">5.1. ¿Cuál es el objetivo principal del chat?</div>
      <div class="checkbox-group">
        <div class="checkbox-item"><span class="checkbox-square"></span> Agendar reunión / llamada</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Derivar a un asesor de ventas</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Enviar link de compra directa</div>
        <div class="checkbox-item"><span class="checkbox-square"></span> Informar y enviar catálogo</div>
      </div>
    </div>

    <div class="question">
      <div class="question-title">5.2. ¿En qué momento exacto la IA debe pausarse y transferir a una persona?</div>
      <div class="question-hint">Ej: cuando el cliente pida hablar con alguien, confirme el pedido, tenga una queja o consulte casos complejos.</div>
      <div class="answer-box"></div>
    </div>

    <div class="question">
      <div class="question-title">5.3. ¿Qué debe responder la IA cuando no tiene la información exacta?</div>
      <div class="question-hint">Regla de oro: nunca inventar. Se avisa cordialmente que un especialista del equipo responderá a la brevedad.</div>
      <div class="answer-line"></div>
    </div>
  </div>

  <!-- BLOQUE 6 -->
  <div class="section">
    <div class="section-title">
      <span class="section-number">6</span>
      Límites Estrictos (Lo que la IA NUNCA debe decir o hacer)
    </div>

    <div class="question">
      <div class="question-title">6.1. ¿Qué promesas, descuentos o temas tiene totalmente prohibido tocar la IA?</div>
      <div class="question-hint">Ej: nunca prometer plazos exactos sin consultar, no dar rebajas no autorizadas, etc.</div>
      <div class="answer-box"></div>
    </div>
  </div>

  <div class="footer">
    Formulario de configuración de Inteligencia Artificial para WhatsApp CRM • Versión SaaS 2026
  </div>

</body>
</html>`;

async function generatePDF() {
  console.log('Iniciando Puppeteer para exportar PDF...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  const outputPath = path.resolve('Cuestionario_Onboarding_IA.pdf');
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '15mm',
      bottom: '15mm',
      left: '15mm',
      right: '15mm'
    }
  });

  await browser.close();
  console.log('PDF generado exitosamente en:', outputPath);

  // También copiar al Escritorio para fácil acceso
  const desktopPath = path.resolve('c:/Users/Alancito/Desktop/Cuestionario_Onboarding_IA.pdf');
  try {
    fs.copyFileSync(outputPath, desktopPath);
    console.log('Copia guardada en el Escritorio:', desktopPath);
  } catch (e) {
    console.log('Nota sobre copia en escritorio:', e.message);
  }
}

generatePDF().catch(err => {
  console.error('Error generando PDF:', err);
  process.exit(1);
});
