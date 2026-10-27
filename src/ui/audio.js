/**
 * WebAudio blips.
 *
 * No audio files, no decoding, no network: three short synthesised hits built from an oscillator
 * and a gain envelope. The AudioContext is created lazily on the first sound *after a user
 * gesture*, because browsers refuse to start audio before one — `unmute()` is called from the
 * click handler that toggles sound.
 */
const VOICES = {
  eat: { type: 'square', from: 660, to: 990, duration: 0.07, gain: 0.16 },
  start: { type: 'triangle', from: 330, to: 660, duration: 0.16, gain: 0.14 },
  pause: { type: 'sine', from: 440, to: 220, duration: 0.1, gain: 0.1 },
  die: { type: 'sawtooth', from: 220, to: 55, duration: 0.42, gain: 0.18 },
  tier: { type: 'square', from: 880, to: 1320, duration: 0.09, gain: 0.12 },
};

export function createAudio({ getContext = () => new (window.AudioContext || window.webkitAudioContext)() } = {}) {
  let ctx = null;
  let broken = false;

  function context() {
    if (broken) return null;
    if (!ctx) {
      try {
        ctx = getContext();
      } catch {
        broken = true;
        return null;
      }
    }
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    return ctx;
  }

  function play(name) {
    const voice = VOICES[name];
    const audio = context();
    if (!voice || !audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(voice.from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, voice.to), now + voice.duration);
    gain.gain.setValueAtTime(voice.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + voice.duration + 0.02);
  }

  return {
    eat: () => play('eat'),
    start: () => play('start'),
    pause: () => play('pause'),
    die: () => play('die'),
    tier: () => play('tier'),
    /** Called from a gesture so the context is running before the first blip is owed. */
    unmute: () => context(),
    /** True when the browser refused to give us an AudioContext at all. */
    get broken() {
      return broken;
    },
  };
}
