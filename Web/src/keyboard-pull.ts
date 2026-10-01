/** Only the dismiss button owns this gesture; text selection stays native. */
export class KeyboardPull {
  private start?: { x: number; y: number; time: number };
  private previous?: { y: number; time: number };
  private distance = 0;
  private velocity = 0;
  private moved = false;
  private rejected = false;

  begin(x: number, y: number, time: number) {
    this.start = { x, y, time };
    this.previous = { y, time };
    this.distance = this.velocity = 0;
    this.moved = this.rejected = false;
  }

  move(x: number, y: number, time: number): number {
    if (!this.start || !this.previous) return 0;
    const dx = Math.abs(x - this.start.x), dy = y - this.start.y;
    if (Math.hypot(dx, dy) > 8) this.moved = true;
    if ((dx > 14 && dx > Math.abs(dy)) || dy < -12) this.rejected = true;
    const elapsed = time - this.previous.time;
    if (elapsed > 0) this.velocity = (y - this.previous.y) / elapsed;
    this.previous = { y, time };
    this.distance = Math.max(0, dy);
    return this.rejected ? 0 : Math.min(40, this.distance * 0.55);
  }

  end(time: number) {
    const recent = this.previous && time - this.previous.time < 80;
    const dismiss = !!this.start && !this.rejected &&
      (this.distance >= 44 || (this.distance >= 20 && !!recent && this.velocity >= 0.5));
    const moved = this.moved;
    this.cancel();
    return { dismiss, moved };
  }

  cancel() { this.start = this.previous = undefined; this.distance = this.velocity = 0; }
}
