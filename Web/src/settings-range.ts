/** Speed sliders run on 0-100 travel, split in half at the middle value. Each half is a
 *  log scale, so the saved handfeel sits exactly in the middle of the slider and both
 *  directions get the same perceptual resolution around it. */
export type SpeedRange = { low: number; middle: number; high: number };
export const speedRanges = {
  pointer: { low: 0.2, middle: 1.5, high: 5 },
  scroll: { low: 0.05, middle: 0.3, high: 5 },
} satisfies Record<string, SpeedRange>;

const between = (from: number, to: number, part: number) => from * Math.pow(to / from, part);

export function positionOf(value: number, range: SpeedRange) {
  const clamped = Math.min(range.high, Math.max(range.low, value));
  return clamped <= range.middle
    ? 50 * Math.log(clamped / range.low) / Math.log(range.middle / range.low)
    : 50 + 50 * Math.log(clamped / range.middle) / Math.log(range.high / range.middle);
}

export function valueAt(position: number, range: SpeedRange) {
  const clamped = Math.min(100, Math.max(0, position));
  const value = clamped <= 50
    ? between(range.low, range.middle, clamped / 50)
    : between(range.middle, range.high, (clamped - 50) / 50);
  return Math.round(value * 1000) / 1000;
}

/** Two decimals, one of them dropped when it is a trailing zero: 0.05, 0.3, 1.5, 5.0. */
export function formatSpeed(value: number) {
  return value.toFixed(2).replace(/0$/, '');
}
