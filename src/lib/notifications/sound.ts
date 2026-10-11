/**
 * Web Audio API Sound Synthesizer for Realtime CRM Notifications
 *
 * Generates beautiful, clean, zero-latency notification sounds in the browser
 * without relying on external mp3 files or network requests.
 */

const STORAGE_KEY = 'wacrm_notification_sound_enabled';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    return audioCtx;
  } catch {
    return null;
  }
}

/** Check if notification sounds are enabled in user settings */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

/** Toggle notification sound preference */
export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {}
}

export type SoundType = 'chime' | 'urgent' | 'lead' | 'message';

/**
 * Plays a pleasant synthetic chime using Web Audio API.
 * - 'chime': Smooth pleasant melodic bell for standard assignments.
 * - 'urgent': Double-chime alert with higher frequency for AI handoffs.
 * - 'lead': Upbeat 3-note ascending chime for new qualified leads.
 */
export function playNotificationSound(type: SoundType = 'chime'): void {
  if (!isSoundEnabled()) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (type === 'urgent') {
    // 🚨 Urgente (AI Handoff / Solicitud de humano): Doble pulso incisivo y claro
    playTone(ctx, 880, now, 0.18, 'triangle', 0.25);
    playTone(ctx, 1318.5, now + 0.05, 0.25, 'sine', 0.25);

    // Segundo pulso 200ms después
    playTone(ctx, 880, now + 0.22, 0.18, 'triangle', 0.25);
    playTone(ctx, 1760, now + 0.27, 0.35, 'sine', 0.3);
  } else if (type === 'lead') {
    // 🌟 Nuevo Lead / Pago: Arpegio ascendente brillante
    playTone(ctx, 523.25, now, 0.15, 'sine', 0.2); // C5
    playTone(ctx, 659.25, now + 0.08, 0.15, 'sine', 0.2); // E5
    playTone(ctx, 783.99, now + 0.16, 0.15, 'sine', 0.2); // G5
    playTone(ctx, 1046.5, now + 0.24, 0.45, 'sine', 0.25); // C6
  } else {
    // 🔔 Chime estándar (Asignación de conversación): Marimba suave 2 notas
    playTone(ctx, 659.25, now, 0.2, 'sine', 0.2); // E5
    playTone(ctx, 987.77, now + 0.1, 0.45, 'sine', 0.25); // B5
  }
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  wave: OscillatorType = 'sine',
  volume: number = 0.25
) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, startTime);

    // Envolvente acústica ADSR suave para evitar 'clicks'
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  } catch {}
}
