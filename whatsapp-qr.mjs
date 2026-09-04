import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth } = pkg;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'crm-session' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

console.log('\n🔄 Iniciando WhatsApp Web... espera unos segundos...\n');

client.on('qr', (qr) => {
  console.log('\n📱 ESCANEÁ ESTE QR CON TU WHATSAPP (+5491154101146):\n');
  qrcode.generate(qr, { small: true });
  console.log('\nAbrí WhatsApp → Dispositivos vinculados → Vincular dispositivo\n');
});

client.on('authenticated', () => {
  console.log('\n✅ Autenticado correctamente!\n');
});

client.on('ready', async () => {
  console.log('\n🚀 WhatsApp listo! Enviando mensaje de prueba...\n');

  // Enviar mensaje de prueba al mismo numero
  const number = '5491154101146@c.us'; // formato de WhatsApp Web
  await client.sendMessage(number, '✅ Hola! Este mensaje fue enviado desde tu CRM. Todo funciona correctamente 🎉');
  
  console.log('✅ Mensaje enviado a +5491154101146!');
  console.log('\nPodés cerrar esta ventana con Ctrl+C\n');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación:', msg);
});

client.initialize();
