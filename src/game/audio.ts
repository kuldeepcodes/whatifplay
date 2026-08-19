export class SillyAudio {
  private context: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }

  play(kind: "jump" | "collect" | "hit" | "throw" | "warning" | "emote" | "splash"): void {
    if (this.muted || !this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const settings = {
      jump: [320, 620, "sine"],
      collect: [660, 980, "triangle"],
      hit: [130, 55, "sawtooth"],
      throw: [240, 90, "square"],
      warning: [440, 440, "square"],
      emote: [180, 540, "sawtooth"],
      splash: [110, 190, "sine"],
    } as const;
    const [start, end, wave] = settings[kind];
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(end, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.21);
  }
}
