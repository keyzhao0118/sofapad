export type ViewportSize = { width: number; height: number; scale: number };

/** Detect native dismissal only after observing an actual keyboard-sized resize. */
export class KeyboardViewport {
  private baseline?: ViewportSize;
  visible = false;

  open(size: ViewportSize) { this.baseline = size; this.visible = false; }
  close() { this.baseline = undefined; this.visible = false; }

  update(size: ViewportSize): boolean {
    const baseline = this.baseline;
    if (!baseline) return false;
    // Rotation and pinch zoom are not keyboard dismissals.
    if (Math.abs(size.width - baseline.width) > 40 || Math.abs(size.scale - 1) > 0.05) {
      this.open(size); return false;
    }
    if (Math.abs(baseline.scale - 1) > 0.05) { this.open(size); return false; }
    if (baseline.height - size.height > Math.max(120, baseline.height * 0.2)) this.visible = true;
    if (this.visible && size.height >= baseline.height - 60) {
      this.close(); return true;
    }
    return false;
  }
}
