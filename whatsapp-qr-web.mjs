import http from 'http';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

let currentQR = null;
let status = 'waiting'; // waiting | qr | authenticated | ready | error

// ─── Servidor HTTP en puerto 3001 ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  const qrImg = currentQR
    ? await qrcode.toDataURL(currentQR, { width: 300, margin: 2 })
    : null;

  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Conectar WhatsApp al CRM</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: white;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 24px;
      padding: 48px;
      text-align: center;
      backdrop-filter: blur(10px);
      max-width: 420px;
      width: 90%;
      box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    p { color: #94a3b8; margin-bottom: 32px; font-size: 15px; line-height: 1.6; }
    .qr-box {
      background: white;
      border-radius: 16px;
      padding: 16px;
      display: inline-block;
      margin-bottom: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }
    .qr-box img { display: block; border-radius: 8px; }
    .steps {
      text-align: left;
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      margin-top: 8px;
    }
    .step {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      font-size: 14px;
      color: #cbd5e1;
    }
    .step-num {
      background: #25d366;
      color: white;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
      flex-shrink: 0;
    }
    .status-ready {
      background: rgba(37,211,102,0.15);
      border: 1px solid #25d366;
      border-radius: 12px;
      padding: 24px;
      color: #25d366;
      font-size: 20px;
      font-weight: 700;
    }
    .status-waiting {
      color: #94a3b8;
      font-size: 16px;
      padding: 32px;
    }
    .spinner {
      border: 3px solid rgba(255,255,255,0.1);
      border-top: 3px solid #25d366;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .refresh-note { font-size: 12px; color: #475569; margin-top: 16px; }
  </style>
  <script>
    // Auto-refresh cada 3 segundos para ver si el estado cambió
    setInterval(async () => {
      const r = await fetch('/status');
      const d = await r.json();
      if (d.status === 'ready' || d.status === 'qr') {
        location.reload();
      }
    }, 3000);
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">💬</div>
    <h1>Conectar WhatsApp al CRM</h1>

    ${status === 'ready' ? `
      <div class="status-ready">
        ✅ ¡WhatsApp conectado!<br/>
        <span style="font-size:14px;font-weight:400;color:#86efac;margin-top:8px;display:block">
          Mensaje enviado a +5491154101146
        </span>
      </div>
    ` : status === 'authenticated' ? `
      <div class="status-waiting">
        <div class="spinner"></div>
        Autenticado, enviando mensaje...
      </div>
    ` : status === 'qr' && qrImg ? `
      <p>Escaneá el QR con tu celular para conectar tu WhatsApp al CRM</p>
      <div class="qr-box">
        <img src="${qrImg}" width="268" height="268" alt="QR Code"/>
      </div>
      <div class="steps">
        <div class="step"><span class="step-num">1</span> Abrí WhatsApp en tu celular</div>
        <div class="step"><span class="step-num">2</span> Tocá los 3 puntos → Dispositivos vinculados</div>
        <div class="step"><span class="step-num">3</span> Tocá "Vincular dispositivo"</div>
        <div class="step"><span class="step-num">4</span> Apuntá la cámara a este QR</div>
      </div>
      <p class="refresh-note">La página se actualiza sola cada 3 segundos</p>
    ` : `
      <div class="status-waiting">
        <div class="spinner"></div>
        Generando QR, espera un momento...
      </div>
    `}
  </div>
</body>
</html>`);
});

server.listen(3001, () => {
  console.log('🌐 Abrí http://localhost:3001 en tu navegador para escanear el QR');
});

// ─── WhatsApp Web Client ────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'crm-session-web' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
  currentQR = qr;
  status = 'qr';
  console.log('📱 QR listo! Abrí http://localhost:3001 y escanealo');
});

client.on('authenticated', () => {
  status = 'authenticated';
  console.log('✅ Autenticado!');
});

client.on('ready', async () => {
  status = 'ready';
  console.log('🚀 WhatsApp listo! Enviando mensaje...');
  try {
    await client.sendMessage('5491154101146@c.us', '✅ Hola! Este mensaje fue enviado desde tu CRM. Todo funciona correctamente 🎉');
    console.log('✅ Mensaje enviado a +5491154101146');
  } catch (e) {
    console.error('❌ Error enviando:', e.message);
  }
});

client.on('auth_failure', () => {
  status = 'error';
});

client.initialize();
