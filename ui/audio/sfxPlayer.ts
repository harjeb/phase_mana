import { SFX_IDS, loadSfxBytes, type SfxCue, type SfxId } from "./sfxCatalog";

export interface SfxSettings {
  enabled: boolean;
  /** Master volume, 0..1. */
  volume: number;
}

/** The same effect cannot retrigger faster than this — a resync that replays a
 *  burst of state changes must not machine-gun one sample. */
const MIN_REPEAT_GAP_MS = 60;
const MAX_VOICES = 10;
const MAX_CUE_VOLUME = 1.5;
const GESTURE_EVENTS = ["pointerdown", "keydown"] as const;

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Plays the game's one-shot sound effects through Web Audio.
 *
 * The context is created lazily by `init()` (the game view calls it once it
 * mounts, long after the click that launched the game) so nothing touches the
 * audio device on the menu screens. Every failure path — no `AudioContext`, a
 * codec the webview cannot decode, a suspended context — degrades to silence.
 */
export class SfxPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SfxId, AudioBuffer>();
  private readonly loading = new Map<SfxId, Promise<void>>();
  private readonly lastPlayedAt = new Map<SfxId, number>();
  private voices = 0;
  private settings: SfxSettings = { enabled: true, volume: 0.7 };
  private gestureListening = false;

  configure(settings: SfxSettings): void {
    this.settings = { enabled: settings.enabled, volume: clampUnit(settings.volume) };
    if (this.master) this.master.gain.value = this.settings.volume;
  }

  /** Create the audio context (once) and start decoding the effects. */
  init(): void {
    if (!this.ctx) {
      if (typeof AudioContext === "undefined") return;
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.settings.volume;
        this.master.connect(this.ctx.destination);
      } catch (error) {
        console.debug("[sfx] audio context unavailable", error);
        this.ctx = null;
        this.master = null;
        return;
      }
    }
    this.resumeOnGesture();
    for (const id of SFX_IDS) void this.load(id);
  }

  play(id: SfxId, volume = 1): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (!this.settings.enabled || this.settings.volume <= 0) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    // A suspended context would queue the sound and release it all at once
    // when the user finally interacts — drop it instead.
    if (ctx.state !== "running") {
      void ctx.resume().catch(() => undefined);
      return;
    }
    const buffer = this.buffers.get(id);
    if (!buffer) {
      void this.load(id);
      return;
    }
    const now = performance.now();
    const last = this.lastPlayedAt.get(id);
    if (last !== undefined && now - last < MIN_REPEAT_GAP_MS) return;
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayedAt.set(id, now);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const cueGain = ctx.createGain();
    cueGain.gain.value = Math.min(MAX_CUE_VOLUME, Math.max(0, volume));
    source.connect(cueGain);
    cueGain.connect(master);
    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      cueGain.disconnect();
    };
    source.start();
  }

  playAll(cues: readonly SfxCue[]): void {
    for (const cue of cues) this.play(cue.id, cue.volume);
  }

  private load(id: SfxId): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.buffers.has(id)) return Promise.resolve();
    const inFlight = this.loading.get(id);
    if (inFlight) return inFlight;
    const task = (async () => {
      try {
        const decoded = await ctx.decodeAudioData(await loadSfxBytes(id));
        this.buffers.set(id, decoded);
      } catch (error) {
        // One undecodable file must not take the rest down.
        console.debug(`[sfx] could not load ${id}`, error);
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, task);
    return task;
  }

  /** Chromium starts a context suspended until the user interacts with the page. */
  private resumeOnGesture(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || this.gestureListening) return;
    if (typeof window === "undefined") return;
    this.gestureListening = true;
    const resume = () => {
      void ctx.resume().then(
        () => {
          if (ctx.state !== "running") return;
          for (const type of GESTURE_EVENTS) window.removeEventListener(type, resume, true);
          this.gestureListening = false;
        },
        () => undefined,
      );
    };
    for (const type of GESTURE_EVENTS) window.addEventListener(type, resume, true);
  }
}

export const sfx = new SfxPlayer();
