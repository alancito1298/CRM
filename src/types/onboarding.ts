export interface OnboardingFaqItem {
  id?: string;
  question: string;
  answer: string;
}

export interface OnboardingQuestionnaireData {
  // Bloque 1: Identidad & Tono
  businessName: string;
  businessDescription: string;
  toneStyle: ('cordial' | 'formal' | 'commercial')[];
  treatment: 'tu' | 'vos' | 'usted';
  assistantPersona: 'bot' | 'agent';
  personaCustomPhrase?: string;

  // Bloque 2: Servicios, Productos y Precios
  mainProducts: string;
  pricingPolicy: 'fixed' | 'custom' | 'both';
  customQuoteRequirements?: string;
  paymentMethods: string;

  // Bloque 3: Filtro de Prospectos & Reglas
  requiredLeadFields: string[]; // 'name' | 'city' | 'email' | 'company' | 'urgency' | 'alt_phone'
  excludedServices: string;

  // Bloque 4: FAQs y Horarios
  faqs: OnboardingFaqItem[];
  locationAndHours: string;

  // Bloque 5: Derivación Humana y Cierre
  chatGoal: 'schedule_call' | 'transfer_sales' | 'buy_link' | 'send_catalog' | 'other';
  handoffTrigger: string;
  unknownQueryResponse: string;

  // Bloque 6: Límites Estrictos
  strictProhibitions: string;

  // Opcional: Proveedor y Credenciales
  provider?: 'groq' | 'openai' | 'gemini' | 'anthropic';
  model?: string;
  apiKey?: string;
}

export const DEFAULT_QUESTIONNAIRE_DATA: OnboardingQuestionnaireData = {
  businessName: '',
  businessDescription: '',
  toneStyle: ['cordial'],
  treatment: 'tu',
  assistantPersona: 'bot',
  personaCustomPhrase: '',

  mainProducts: '',
  pricingPolicy: 'custom',
  customQuoteRequirements: '',
  paymentMethods: '',

  requiredLeadFields: ['name', 'city'],
  excludedServices: '',

  faqs: [
    { question: '¿Cuáles son sus medios de pago?', answer: 'Aceptamos transferencias bancarias, tarjetas de crédito/débito y efectivo.' },
    { question: '¿Realizan envíos a todo el país?', answer: 'Sí, despachamos pedidos a todo el territorio nacional con seguimiento online.' },
    { question: '¿Cuál es el tiempo de entrega estimado?', answer: 'Los tiempos de entrega habituales son de 2 a 5 días hábiles una vez confirmado el pedido.' },
  ],
  locationAndHours: 'Lunes a Viernes de 9:00 a 18:00 hs. Sábados de 9:00 a 13:00 hs.',

  chatGoal: 'transfer_sales',
  handoffTrigger: 'Cuando el cliente confirme que desea comprar, solicite hablar con una persona, o tenga una consulta que requiera confirmación personalizada.',
  unknownQueryResponse: 'Para brindarte información exacta y confirmada, un asesor especializado de nuestro equipo te responderá por este mismo chat a la brevedad.',

  strictProhibitions: 'Nunca inventar precios ni promociones que no estén en la lista. No asegurar plazos de entrega sin confirmación previa del equipo.',

  provider: 'groq',
  model: 'llama-3.1-8b-instant',
  apiKey: '',
};

export function generateSystemPromptFromQuestionnaire(data: OnboardingQuestionnaireData): string {
  const treatmentDesc =
    data.treatment === 'vos'
      ? 'Tratamiento: Voseo rioplatense ("vos", "tenés", "podés", "avisame", "escribime").'
      : data.treatment === 'usted'
      ? 'Tratamiento: Formal de respeto ("usted", "tiene", "puede", "avísenos").'
      : 'Tratamiento: Tuteo amigable ("tú", "tienes", "puedes", "avísame").';

  const toneDesc: string[] = [];
  if (data.toneStyle.includes('cordial')) toneDesc.push('cercano, cordial y con emojis moderados');
  if (data.toneStyle.includes('formal')) toneDesc.push('corporativo, formal y directo');
  if (data.toneStyle.includes('commercial')) toneDesc.push('dinámico, persuasivo y comercial enfocado en soluciones');
  const toneStr = toneDesc.length > 0 ? toneDesc.join(', ') : 'cordial, profesional y claro';

  const personaDesc =
    data.assistantPersona === 'bot'
      ? `Identifícate como asistente virtual inteligente ${data.personaCustomPhrase ? `("${data.personaCustomPhrase}")` : `de ${data.businessName || 'la empresa'}`}.`
      : `Identifícate como asesor del equipo de atención al cliente ${data.personaCustomPhrase ? `("${data.personaCustomPhrase}")` : `de ${data.businessName || 'la empresa'}`}.`;

  const sections: string[] = [];

  sections.push(`# IDENTIDAD Y ROL
Eres el asistente virtual oficial en WhatsApp para "${data.businessName || 'nuestra empresa'}".
${data.businessDescription ? `A qué se dedica y propuesta de valor: ${data.businessDescription}` : ''}
${personaDesc}
Tono de comunicación: ${toneStr}.
${treatmentDesc}
Formato de respuesta: Mensajes concisos, directos y naturales para WhatsApp (1 a 3 párrafos cortos). Evita respuestas excesivamente largas.`);

  if (data.mainProducts) {
    sections.push(`# PRODUCTOS Y SERVICIOS
${data.mainProducts}

Política de precios: ${
      data.pricingPolicy === 'fixed'
        ? 'Precios fijos. Brinda los valores con claridad cuando el cliente los solicite.'
        : data.pricingPolicy === 'custom'
        ? 'Presupuestos personalizados a medida.'
        : 'Disponemos de precios de catálogo y presupuestos personalizados a medida.'
    }
${data.customQuoteRequirements ? `Para cotizar a medida, solicita amablemente los siguientes datos:\n${data.customQuoteRequirements}` : ''}
${data.paymentMethods ? `Métodos de pago y promociones:\n${data.paymentMethods}` : ''}`);
  }

  const fieldLabels: Record<string, string> = {
    name: 'Nombre y Apellido',
    city: 'Ciudad / Localidad',
    email: 'Correo Electrónico',
    company: 'Nombre de su Empresa / Negocio',
    urgency: 'Urgencia o fecha estimada de inicio',
    alt_phone: 'Teléfono alternativo de contacto',
  };

  const leadFieldsDesc = (data.requiredLeadFields || [])
    .map((f) => `- ${fieldLabels[f] || f}`)
    .join('\n');

  if (leadFieldsDesc || data.excludedServices) {
    sections.push(`# CALIFICACIÓN Y FILTRO DE PROSPECTOS
${leadFieldsDesc ? `Durante la conversación de forma progresiva, procura recopilar estos datos clave antes del cierre:\n${leadFieldsDesc}` : ''}
${data.excludedServices ? `Servicios o productos que NO ofrecemos:\n${data.excludedServices}\nSi consultan por estos servicios, agradece el interés e informa amablemente que no brindamos esa prestación.` : ''}`);
  }

  if (data.locationAndHours) {
    sections.push(`# UBICACIÓN, HORARIOS Y ENVÍOS
${data.locationAndHours}`);
  }

  const goalDescriptions: Record<string, string> = {
    schedule_call: 'Agendar una videollamada o reunión telefónica con el equipo.',
    transfer_sales: 'Calificar al prospecto y derivarlo directamente a un asesor de ventas especializado.',
    buy_link: 'Guiar al cliente hasta facilitarle el enlace de pago o compra directa.',
    send_catalog: 'Brindar información y compartir el catálogo de opciones disponibles.',
    other: 'Resolver dudas rápidamente y guiar al cliente al paso siguiente.',
  };

  sections.push(`# OBJETIVO Y DERIVACIÓN A ASESOR HUMANO (HANDOFF)
Objetivo prioritario del chat: ${goalDescriptions[data.chatGoal] || goalDescriptions.transfer_sales}

Momento de transferencia a humano:
${data.handoffTrigger || 'Transfiere al asesor cuando el cliente confirme interés de compra, pida hablar con una persona o formule una consulta técnica fuera de tu alcance.'}

Respuesta ante dudas sin información confirmada:
${data.unknownQueryResponse || 'Nunca inventes información. Indica cordialmente que consultarás con el equipo y que un especialista se comunicará por este mismo chat.'}`);

  if (data.strictProhibitions) {
    sections.push(`# LÍMITES ESTRICTOS (LO QUE NUNCA DEBES DECIR NI HACER)
${data.strictProhibitions}
- NUNCA inventes descuentos, rebajas o condiciones no autorizadas.
- NUNCA des fechas de entrega sin que estén corroboradas.
- Mantén siempre una actitud cordial, atenta y orientada a soluciones.`);
  }

  return sections.join('\n\n');
}
