let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (!audioContext) {
    audioContext = new AudioContextCtor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.72;
    masterGain.connect(audioContext.destination);
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined);
  }

  return audioContext;
};

const connectGain = (ctx: AudioContext, value: number, when: number, duration: number): GainNode => {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(value, 0.0002), when + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  gain.connect(masterGain || ctx.destination);
  return gain;
};

const createNoiseBuffer = (ctx: AudioContext, duration: number): AudioBuffer => {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i += 1) {
    const envelope = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  return buffer;
};

/** Short tactile click inspired by a mechanical keyboard switch. */
export const playMechanicalKeySound = (): void => {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'closed') return;

  const now = ctx.currentTime;

  // Crisp switch click.
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.028);
  const bandPass = ctx.createBiquadFilter();
  bandPass.type = 'bandpass';
  bandPass.frequency.setValueAtTime(2650, now);
  bandPass.Q.setValueAtTime(1.4, now);
  const noiseGain = connectGain(ctx, 0.115, now, 0.026);
  noise.connect(bandPass);
  bandPass.connect(noiseGain);
  noise.start(now);
  noise.stop(now + 0.03);

  // Low mechanical body / keycap thock.
  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(185, now);
  body.frequency.exponentialRampToValueAtTime(118, now + 0.032);
  const bodyGain = connectGain(ctx, 0.075, now, 0.04);
  body.connect(bodyGain);
  body.start(now);
  body.stop(now + 0.045);

  // Tiny return click, characteristic of a switch spring.
  const returnClick = ctx.createOscillator();
  returnClick.type = 'square';
  returnClick.frequency.setValueAtTime(820, now + 0.018);
  const returnGain = connectGain(ctx, 0.018, now + 0.018, 0.018);
  returnClick.connect(returnGain);
  returnClick.start(now + 0.018);
  returnClick.stop(now + 0.04);
};

/** Soft iOS-like confirmation / alert chime for in-app messages. */
export const playMessageSound = (kind: 'success' | 'error' = 'success'): void => {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'closed') return;

  const now = ctx.currentTime;
  const notes = kind === 'success'
    ? [659.25, 783.99, 987.77]
    : [440, 369.99];

  notes.forEach((frequency, index) => {
    const start = now + index * 0.075;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);

    const gain = connectGain(ctx, kind === 'success' ? 0.055 : 0.065, start, kind === 'success' ? 0.18 : 0.22);
    oscillator.connect(gain);
    oscillator.start(start);
    oscillator.stop(start + (kind === 'success' ? 0.2 : 0.24));
  });
};

const isSoundButton = (target: EventTarget | null): target is HTMLElement => {
  if (!(target instanceof Element)) return false;
  const button = target.closest('button, [role="button"]') as HTMLElement | null;
  if (!button) return false;
  if (button instanceof HTMLButtonElement && button.disabled) return false;
  if (button.getAttribute('aria-disabled') === 'true') return false;
  if (button.dataset.sound === 'off') return false;
  return true;
};

let installed = false;

/**
 * Adds one delegated listener for the whole application, including buttons rendered later in modals.
 * Pointer and keyboard activation are both covered without wiring every component individually.
 */
export const installButtonSounds = (): void => {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('pointerdown', (event) => {
    if (!isSoundButton(event.target)) return;
    playMechanicalKeySound();
  }, { capture: true, passive: true });

  document.addEventListener('keydown', (event) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    if (!isSoundButton(event.target)) return;
    playMechanicalKeySound();
  }, true);
};
