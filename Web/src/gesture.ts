export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'click'; button: 'left' | 'right'; count: 1 | 2 }
  | { type: 'scroll' | 'drag'; dx: number; dy: number; phase: 'begin' | 'update' | 'end' | 'cancel' };
type Point = { x: number; y: number; startX: number; startY: number };
export const thresholds = { tapMs: 240, slop: 8, scrollSlop: 5, dragSlop: 8, twoFingerJoinMs: 120, threeFingerJoinMs: 180, doubleTapSlop: 24 };

export class GestureEngine {
  private points = new Map<number, Point>();
  private mode: 'idle' | 'single' | 'move' | 'two' | 'scroll' | 'three' | 'drag' | 'blocked' = 'idle';
  private began = 0;
  private tapEligible = true;
  private center = { x: 0, y: 0 };
  private pendingRight = false;
  private lastTap?: { time: number; x: number; y: number };
  doubleClickMs = 500;
  constructor(private emit: (action: Action) => void) {}
  down(id: number, x: number, y: number, now: number) {
    if (this.points.has(id)) return;
    this.points.set(id, { x, y, startX: x, startY: y });
    if (this.points.size === 1) {
      this.mode = 'single'; this.began = now; this.tapEligible = true; this.pendingRight = false;
    } else if (this.points.size === 2 && (this.mode === 'single' || this.mode === 'move')) {
      this.tapEligible = this.mode === 'single' && now - this.began <= thresholds.twoFingerJoinMs;
      this.mode = 'two'; this.center = this.centroid(); this.lastTap = undefined;
    } else if (this.points.size === 3 && this.mode === 'two' && now - this.began <= thresholds.threeFingerJoinMs) {
      this.mode = 'three'; this.center = this.centroid(); this.tapEligible = false; this.lastTap = undefined;
    } else { this.cancel(); }
  }
  move(id: number, x: number, y: number) {
    const point = this.points.get(id); if (!point) return;
    const dx = x - point.x, dy = y - point.y;
    point.x = x; point.y = y;
    if (Math.hypot(x - point.startX, y - point.startY) > thresholds.slop) {
      this.tapEligible = false; this.pendingRight = false;
    }
    if (this.mode === 'single' && !this.tapEligible) {
      this.mode = 'move'; this.lastTap = undefined;
      this.emit({ type: 'move', dx: x - point.startX, dy: y - point.startY });
    } else if (this.mode === 'move') { this.emit({ type: 'move', dx, dy });
    } else if (this.mode === 'two' || this.mode === 'scroll') {
      const center = this.centroid(), cx = center.x - this.center.x, cy = center.y - this.center.y;
      if (this.mode === 'scroll' || Math.hypot(cx, cy) > thresholds.scrollSlop) {
        this.emit({ type: 'scroll', dx: cx, dy: cy, phase: this.mode === 'two' ? 'begin' : 'update' });
        this.mode = 'scroll'; this.tapEligible = false; this.center = center;
      }
    } else if (this.mode === 'three' || this.mode === 'drag') {
      const center = this.centroid(), cx = center.x - this.center.x, cy = center.y - this.center.y;
      if (this.mode === 'drag' || Math.hypot(cx, cy) > thresholds.dragSlop) {
        this.emit({ type: 'drag', dx: cx, dy: cy, phase: this.mode === 'three' ? 'begin' : 'update' });
        this.mode = 'drag'; this.center = center;
      }
    }
  }
  up(id: number, x: number, y: number, now: number) {
    const point = this.points.get(id); if (!point) return;
    this.move(id, x, y);
    if (this.mode === 'single' && this.tapEligible && now - this.began <= thresholds.tapMs) {
      const last = this.lastTap;
      const double = last && now - last.time <= this.doubleClickMs && Math.hypot(x - last.x, y - last.y) <= thresholds.doubleTapSlop;
      this.emit({ type: 'click', button: 'left', count: double ? 2 : 1 });
      this.lastTap = double ? undefined : { time: now, x, y };
    } else if (this.mode === 'scroll' || this.mode === 'drag') {
      this.emit({ type: this.mode, dx: 0, dy: 0, phase: 'end' });
      this.mode = 'blocked';
    } else if (this.mode === 'two') {
      this.pendingRight = this.tapEligible && now - this.began <= thresholds.tapMs;
      this.mode = 'blocked';
    } else if (this.mode === 'three') {
      this.mode = 'blocked'; this.lastTap = undefined;
    } else if (this.mode !== 'blocked') { this.lastTap = undefined; }
    this.points.delete(id);
    if (this.points.size === 0) {
      if (this.pendingRight && now - this.began <= thresholds.tapMs) this.emit({ type: 'click', button: 'right', count: 1 });
      this.pendingRight = false; this.mode = 'idle';
    }
  }
  cancel() {
    if (this.mode === 'scroll' || this.mode === 'drag') this.emit({ type: this.mode, dx: 0, dy: 0, phase: 'cancel' });
    this.mode = this.points.size ? 'blocked' : 'idle'; this.pendingRight = false; this.lastTap = undefined;
  }
  reset() { this.cancel(); this.points.clear(); this.mode = 'idle'; }
  cancelContact(id: number) {
    if (!this.points.has(id)) return;
    this.cancel(); this.points.delete(id);
    if (!this.points.size) this.mode = 'idle';
  }
  private centroid() {
    const points = [...this.points.values()];
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  }
}
