/** One reversible timeline for the panel and the keyboard/chevron glyph. */
export class KeyboardTransition {
  private value = 0;
  private frame = 0;
  constructor(private paint: (progress: number) => void,
    private schedule: (run: (time: number) => void) => number = run => requestAnimationFrame(run),
    private cancel: (id: number) => void = id => cancelAnimationFrame(id),
    private now: () => number = () => performance.now()) {}

  show(open: boolean, reducedMotion = false) {
    this.cancel(this.frame);
    this.frame = 0;
    const target = open ? 1 : 0, start = this.value, began = this.now();
    if (reducedMotion || start === target) {
      this.value = target; this.paint(target); return;
    }
    // Reversing mid-flight starts at the rendered position, never at an endpoint.
    const tick = (time: number) => {
      const elapsed = Math.min(1, Math.max(0, (time - began) / 280));
      this.value = start + (target - start) * (1 - (1 - elapsed) ** 3);
      this.paint(this.value);
      this.frame = elapsed < 1 ? this.schedule(tick) : 0;
    };
    this.frame = this.schedule(tick);
  }
}
