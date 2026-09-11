export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'click'; button: 'left' | 'right'; count: 1 | 2 }
  | { type: 'scroll' | 'drag'; dx: number; dy: number; phase: 'begin' | 'update' | 'end' | 'cancel' };
type Point = { x: number; y: number; startX: number; startY: number };
export const thresholds = { tapMs: 240, longPressMs: 500, slop: 8, scrollSlop: 5, dragSlop: 8, twoFingerJoinMs: 120, threeFingerJoinMs: 180, doubleTapSlop: 24 };

export class GestureEngine {
  private points = new Map<number, Point>();
  private mode: 'idle' | 'single' | 'move' | 'two' | 'edge' | 'scroll' | 'three' | 'drag' | 'blocked' = 'idle';
  private edgeScroll = false;
  private longPressTimer?: ReturnType<typeof setTimeout>;
  private began = 0;
  private tapEligible = true;
  private center = { x: 0, y: 0 };
  private pendingRight = false;
  private lastTap?: { time: number; x: number; y: number };
  private doubleTapCandidate = false;
  private dragKind?: 'single' | 'three';
  doubleClickMs = 500;
  constructor(private emit: (action: Action) => void) {}
  down(id: number, x: number, y: number, now: number, zone: 'pointer' | 'scroll' = 'pointer') {
    if (this.points.has(id)) return;
    this.points.set(id, { x, y, startX: x, startY: y });
    this.clearLongPress();
    if (this.points.size === 1) {
      this.mode = 'single'; this.began = now; this.tapEligible = true; this.pendingRight = false;
      this.dragKind = undefined;
      this.edgeScroll = zone === 'scroll';
      if (this.edgeScroll) {
        this.mode = 'edge'; this.tapEligible = false; this.lastTap = undefined; this.doubleTapCandidate = false;
        return;
      }
      const last = this.lastTap;
      this.doubleTapCandidate = !!last && now - last.time <= this.doubleClickMs && Math.hypot(x - last.x, y - last.y) <= thresholds.doubleTapSlop;
      if (!this.doubleTapCandidate) this.longPressTimer = setTimeout(() => this.longPress(), thresholds.longPressMs);
    } else if (this.edgeScroll || zone === 'scroll') {
      // Mixed zones never turn a scroll into a click, drag, or pointer movement.
      this.cancel();
    } else if (this.points.size === 2 && (this.mode === 'single' || this.mode === 'move')) {
      this.doubleTapCandidate = false;
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
      this.clearLongPress();
    }
    if (this.mode === 'edge' || (this.mode === 'scroll' && this.edgeScroll)) {
      const began = this.mode === 'edge';
      const amount = began ? y - point.startY : dy;
      if ((began && Math.abs(amount) > thresholds.scrollSlop) || (!began && amount !== 0)) {
        this.mode = 'scroll';
        this.emit({ type: 'scroll', dx: 0, dy: amount, phase: began ? 'begin' : 'update' });
      }
    } else if (this.mode === 'single' && !this.tapEligible) {
      this.lastTap = undefined;
      if (this.doubleTapCandidate) {
        this.mode = 'drag'; this.dragKind = 'single'; this.doubleTapCandidate = false;
        this.emit({ type: 'drag', dx: x - point.startX, dy: y - point.startY, phase: 'begin' });
      } else {
        this.mode = 'move'; this.emit({ type: 'move', dx: x - point.startX, dy: y - point.startY });
      }
    } else if (this.mode === 'move') { this.emit({ type: 'move', dx, dy });
    } else if (this.mode === 'drag' && this.dragKind === 'single') {
      this.emit({ type: 'drag', dx, dy, phase: 'update' });
    } else if (this.mode === 'two' || this.mode === 'scroll') {
      const center = this.centroid(), cx = center.x - this.center.x, cy = center.y - this.center.y;
      if (this.mode === 'scroll' || Math.hypot(cx, cy) > thresholds.scrollSlop) {
        const phase = this.mode === 'two' ? 'begin' : 'update';
        this.mode = 'scroll'; this.tapEligible = false; this.center = center;
        this.emit({ type: 'scroll', dx: cx, dy: cy, phase });
      }
    } else if (this.mode === 'three' || this.mode === 'drag') {
      const center = this.centroid(), cx = center.x - this.center.x, cy = center.y - this.center.y;
      if (this.mode === 'drag' || Math.hypot(cx, cy) > thresholds.dragSlop) {
        const phase = this.mode === 'three' ? 'begin' : 'update';
        this.mode = 'drag'; this.dragKind = 'three'; this.center = center;
        this.emit({ type: 'drag', dx: cx, dy: cy, phase });
      }
    }
  }
  up(id: number, x: number, y: number, now: number) {
    const point = this.points.get(id); if (!point) return;
    this.clearLongPress();
    this.move(id, x, y);
    if (this.mode === 'single' && this.tapEligible && now - this.began <= thresholds.tapMs) {
      const last = this.lastTap;
      const double = last && now - last.time <= this.doubleClickMs && Math.hypot(x - last.x, y - last.y) <= thresholds.doubleTapSlop;
      this.emit({ type: 'click', button: 'left', count: double ? 2 : 1 });
      this.lastTap = double ? undefined : { time: now, x, y };
    } else if (this.mode === 'scroll' || this.mode === 'drag') {
      const type = this.mode;
      this.mode = 'blocked';
      this.emit({ type, dx: 0, dy: 0, phase: 'end' });
    } else if (this.mode === 'two') {
      this.pendingRight = this.tapEligible && now - this.began <= thresholds.tapMs;
      this.mode = 'blocked';
    } else if (this.mode === 'three') {
      this.mode = 'blocked'; this.lastTap = undefined;
    } else if (this.mode !== 'blocked') { this.lastTap = undefined; }
    this.points.delete(id);
    if (this.points.size === 0) {
      if (this.pendingRight && now - this.began <= thresholds.tapMs) this.emit({ type: 'click', button: 'right', count: 1 });
      this.pendingRight = false; this.mode = 'idle'; this.doubleTapCandidate = false; this.dragKind = undefined;
    }
  }
  cancel() {
    this.clearLongPress();
    const ending = this.mode === 'scroll' || this.mode === 'drag' ? this.mode : undefined;
    this.mode = this.points.size ? 'blocked' : 'idle'; this.pendingRight = false; this.lastTap = undefined;
    this.doubleTapCandidate = false; this.dragKind = undefined;
    if (ending) this.emit({ type: ending, dx: 0, dy: 0, phase: 'cancel' });
  }
  reset() { this.cancel(); this.points.clear(); this.mode = 'idle'; }
  cancelContact(id: number) {
    if (!this.points.has(id)) return;
    this.cancel(); this.points.delete(id);
    if (!this.points.size) this.mode = 'idle';
  }
  private clearLongPress() { clearTimeout(this.longPressTimer); this.longPressTimer = undefined; }
  private longPress() {
    this.longPressTimer = undefined;
    if (this.mode !== 'single' || this.points.size !== 1 || !this.tapEligible || this.doubleTapCandidate) return;
    this.mode = 'blocked'; this.tapEligible = false; this.lastTap = undefined;
    this.emit({ type: 'click', button: 'right', count: 1 });
  }
  private centroid() {
    const points = [...this.points.values()];
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  }
}
