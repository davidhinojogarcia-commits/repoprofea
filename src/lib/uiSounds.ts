let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

function playTone({
  frequency,
  endFrequency,
  duration,
  volume,
}: {
  frequency: number;
  endFrequency?: number;
  duration: number;
  volume: number;
}) {
  const context = getAudioContext();
  if (!context) return;

  try {
    if (context.state === 'suspended') void context.resume();

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  } catch {
    // Audio is a non-critical UI enhancement; never interrupt the app.
  }
}

/** Short mechanical key-click for buttons. */
export function playButtonSound() {
  playTone({ frequency: 880, endFrequency: 720, duration: 0.045, volume: 0.045 });
}

/** Soft two-part "bubble" sound for database notifications. */
export function playNotificationSound() {
  playTone({ frequency: 520, endFrequency: 760, duration: 0.09, volume: 0.055 });
  setTimeout(() => {
    playTone({ frequency: 760, endFrequency: 980, duration: 0.12, volume: 0.045 });
  }, 65);
}

/** Install the global button click sound once for the whole application. */
export function installButtonSounds() {
  if (typeof document === 'undefined') return () => undefined;
  const marker = '__profeaButtonSoundsInstalled';
  const documentWithMarker = document as Document & { [marker]?: boolean };
  if (documentWithMarker[marker]) return () => undefined;
  documentWithMarker[marker] = true;

  const handleClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const button = target?.closest('button, [role="button"]');
    if (button) playButtonSound();
  };

  document.addEventListener('click', handleClick, true);
  return () => document.removeEventListener('click', handleClick, true);
}
