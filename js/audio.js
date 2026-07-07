// The flight engine drone is generated in the browser with Web Audio, so the
// app ships no audio files and stays fully offline. One master volume controls
// it and resets to 8% on every takeoff.
export class FlightAudio {
  constructor() {
    this.master = 0.08;
    this.ctx = null;
    this.masterGain = null;
    this.engineGain = null;
  }

  // Build (and resume) the audio graph — call from a user gesture (Board click).
  prime() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.master;
    this.masterGain.connect(ctx.destination);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0001;
    this.engineGain.connect(this.masterGain);

    // brown-noise rush through a lowpass = jet/cabin drone
    const n = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 2.6; }
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 430; lp.Q.value = 0.7;
    noise.connect(hp); hp.connect(lp); lp.connect(this.engineGain);
    // slow rumble on the cutoff
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.17;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 80;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    // low body hum
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 76;
    const humGain = ctx.createGain(); humGain.gain.value = 0.08;
    hum.connect(humGain); humGain.connect(this.engineGain);
    noise.start(); lfo.start(); hum.start();
    ctx.resume?.();
  }

  startEngine() {
    this.prime();
    if (!this.ctx) return;
    this.ctx.resume?.();
    this.engineGain.gain.setTargetAtTime(0.7, this.ctx.currentTime, 1.4);
  }
  stopEngine() {
    if (!this.ctx) return;
    this.engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.6);
  }

  setVolume(v) {
    this.master = Math.max(0, Math.min(1, v));
    if (this.ctx && this.masterGain) this.masterGain.gain.setTargetAtTime(this.master, this.ctx.currentTime, 0.05);
  }

  silence() {
    this.stopEngine();
  }
}
