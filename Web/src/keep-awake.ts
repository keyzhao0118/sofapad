import { wakeVideo } from './wake-media.js';

type Lock = { released: boolean; release(): Promise<void>; addEventListener(type: 'release', run: () => void): void };
type Video = { paused: boolean; play(): Promise<void>; pause(): void };
export type AwakeState = 'disabled' | 'waiting' | 'native' | 'video' | 'paused' | 'blocked';

/** One foreground-only lease. HTTP uses a local silent clip, started by a real touch. */
export class KeepAwake {
  private visible = false;
  private pageVisible = false;
  private enabled = true;
  private generation = 0;
  private pending = false;
  private lock?: Lock;
  private video?: Video;
  private activated = false;
  constructor(private request: (() => Promise<Lock>) | undefined,
    private makeVideo: () => Video, private report: (state: AwakeState) => void) {}

  visibility(visible: boolean) {
    this.pageVisible = visible;
    visible = visible && this.enabled;
    if (!this.enabled) this.report('disabled');
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) this.resume();
    else {
      this.generation++;
      const lock = this.lock; this.lock = undefined;
      if (lock) void lock.release().catch(() => {});
      this.video?.pause();
      this.report(this.enabled ? 'paused' : 'disabled');
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.visibility(this.pageVisible);
  }

  /** Call directly in a trusted touch/key handler: do not defer video.play(). */
  resume(gesture = false) {
    if (!this.visible) return;
    if (gesture) this.activated = true;
    if (this.pending || (this.lock && !this.lock.released)) return;
    if (this.request) {
      this.pending = true;
      const generation = this.generation;
      void this.request().then(lock => {
        if (!this.visible || generation !== this.generation) {
          void lock.release().catch(() => {}); return;
        }
        this.lock = lock;
        this.report('native');
        lock.addEventListener('release', () => {
          if (this.lock !== lock) return;
          this.lock = undefined;
          // Respect system revocation (e.g. low power); retry on the next touch/return.
          this.report(this.visible ? 'blocked' : 'paused');
        });
      }).catch(() => {
        if (this.visible && generation === this.generation) this.report('blocked');
      }).finally(() => {
        this.pending = false;
        if (this.visible && generation !== this.generation) this.resume();
      });
      return;
    }
    if (!this.activated) { this.report('waiting'); return; }
    this.video ??= this.makeVideo();
    if (!this.video.paused) return;
    this.pending = true;
    const generation = this.generation;
    void this.video.play().then(() => {
      if (!this.visible || generation !== this.generation) this.video?.pause();
      else this.report('video');
    }).catch(() => {
      if (this.visible && generation === this.generation) this.report('blocked');
    }).finally(() => {
      this.pending = false;
      if (this.visible && generation !== this.generation) this.resume();
    });
  }
}

export function createWakeVideo(report: (state: AwakeState) => void): HTMLVideoElement {
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.preload = 'auto';
    video.src = wakeVideo;
    // WebKit's shouldDisableSleep explicitly excludes loop() media. Keep the
    // upstream MP4's silent audio and manual seeking; do NOT set loop or muted.
    video.loop = false;
    video.addEventListener('timeupdate', () => {
      if (!video.paused && !video.seeking && video.currentTime > 0.5) video.currentTime = Math.random() * 0.5;
    });
    for (const event of ['pause', 'ended', 'error']) video.addEventListener(event, () => {
      if (!document.hidden) report('blocked');
    });
    return video;
}

export function createKeepAwake(report: (state: AwakeState) => void): KeepAwake {
  // A secure localhost preview can expose this API even though LAN HTTP does not.
  const request = window.isSecureContext && navigator.wakeLock
    ? () => navigator.wakeLock.request('screen') : undefined;
  return new KeepAwake(request, () => createWakeVideo(report), report);
}
