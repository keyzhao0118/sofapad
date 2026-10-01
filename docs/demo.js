// A local illustration: no connection to the Mac, and no native input events.
export const scenes = [
  { id: 'play', boundaries: [.43, .5], samples: [.28, .46, .9], title: '移动与点击', action: '滑动，再轻点', result: '指针移动，视频开始播放', steps: ['单指滑动', '轻点播放', '大屏开始播放'] },
  { id: 'scroll', boundaries: [.22, .78], samples: [.16, .57, .9], title: '单手滚动', action: '沿手机边缘上滑', result: '大屏列表同步向上滚动', steps: ['拇指落在边缘', '沿边缘上滑', '继续浏览列表'] },
  { id: 'drag', boundaries: [.34, .369], samples: [.18, .355, .9], title: '拖动进度条', action: '轻点 → 再按住稍停 → 滑动', result: '按住左键，拖动播放进度', steps: ['轻点一次', '再次按住稍停', '滑动拖动，抬手结束'] },
  { id: 'type', boundaries: [.22, .65], samples: [.18, .57, .95], title: '中文输入', action: '点键盘，用手机选词', result: '文字出现在 Mac 当前输入框', steps: ['先点中 Mac 输入框', '手机键盘选词', '提交到 Mac，收起键盘'] },
  { id: 'double', boundaries: [.43, .468], samples: [.28, .46, .9], title: '双击打开', action: '快速轻点两次', result: 'Mac 打开选中的照片', steps: ['移动到照片', '快速轻点两次', '照片打开'] },
  { id: 'right', boundaries: [.4, .461], samples: [.28, .43, .9], title: '长按右击', action: '静止按住约半秒', result: 'Mac 弹出右键菜单', steps: ['移动到目标', '静止按住约 0.5 秒', '右键菜单出现'] }
];
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const between = (t, start, end) => clamp((t - start) / (end - start));
const lerp = (a, b, t) => a + (b - a) * t;
export function frameAt(id, time) {
  const t = clamp(time), move = ease(between(t, .08, .38));
  const f = { t, step: t < .38 ? 0 : t < .7 ? 1 : 2, touch: false, x: 100, y: 235, cx: lerp(365, 280, move), cy: lerp(240, 155, move), pulse: 0, playing: false, scroll: 0, progress: .22, keyboard: 0, draft: '', text: '', photo: false, menu: false, hold: 0 };
  if (id === 'play' || id === 'double' || id === 'right') {
    f.x = lerp(86, 120, move); f.y = lerp(245, 205, move); f.touch = t > .08 && t < .38;
    if (id === 'play') { f.touch ||= t > .43 && t < .5; f.pulse = Math.sin(Math.PI * between(t, .43, .64)); f.playing = t >= .5; f.progress = .22 + .12 * between(t, .5, .95); }
    if (id === 'double') { f.cx = lerp(365, 139, move); f.cy = lerp(240, 147, move); f.touch ||= (t > .43 && t < .44) || (t > .458 && t < .468); f.pulse = t < .458 ? Math.sin(Math.PI * between(t, .43, .458)) : Math.sin(Math.PI * between(t, .458, .52)); f.photo = t >= .468; }
    if (id === 'right') { f.cx = lerp(365, 226, move); f.cy = lerp(240, 150, move); f.touch ||= t > .4 && t < .461; f.hold = between(t, .4, .461); f.menu = t >= .461; }
  }
  if (id === 'scroll') { const p = ease(between(t, .22, .76)); f.x = 185; f.y = lerp(287, 156, p); f.touch = t > .12 && t < .78; f.scroll = p * 122; f.cx = 416; f.cy = 226; }
  if (id === 'drag') { const p = ease(between(t, .369, .79)); f.x = lerp(82, 145, p); f.y = 236; f.cx = lerp(158, 371, p); f.cy = 285; f.touch = (t > .16 && t < .2) || (t > .34 && t < .82); f.progress = lerp(.22, .66, p); f.hold = between(t, .34, .369); }
  if (id === 'type') {
    f.cx = lerp(365, 202, ease(between(t, .04, .16))); f.cy = lerp(240, 76, ease(between(t, .04, .16)));
    f.keyboard = ease(between(t, .22, .3)) * (1 - ease(between(t, .83, .92)));
    f.x = t < .3 || t > .83 ? 170 : 112; f.y = t < .3 || t > .83 ? 34 : 315;
    f.touch = (t > .2 && t < .25) || (t > .42 && t < .46) || (t > .61 && t < .65) || (t > .83 && t < .87);
    f.draft = t > .32 && t < .46 ? 'zhou mo' : t > .53 && t < .65 ? 'dian ying' : '';
    f.text = t >= .65 ? '周末电影' : t >= .46 ? '周末' : '';
    f.step = t < .22 ? 0 : t < .65 ? 1 : 2;
  }
  const scene = scenes.find(scene => scene.id === id);
  if (scene) f.step = t < scene.boundaries[0] ? 0 : t < scene.boundaries[1] ? 1 : 2;
  return f;
}

function mountDemo() {
  const root = document.querySelector('#demo');
  if (!root) return;
  const get = id => root.querySelector('#' + id);
  const setText = (id, text) => { get(id).textContent = text; };
  const opacity = (id, value) => { get(id).style.opacity = value; };
  let index = 0, time = 0, last = 0, raf = null, inView = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  const duration = 8200;
  const controls = document.querySelectorAll('button[data-scene]');
  const steps = root.querySelectorAll('[data-step]');
  function paint() {
    const scene = scenes[index], f = frameAt(scene.id, time);
    root.dataset.scene = scene.id;
    get('demo-finger').setAttribute('transform', `translate(${f.x} ${f.y})`);
    opacity('demo-finger', f.touch ? 1 : .22);
    const trailStart = scene.id === 'scroll' ? [185, 287] : scene.id === 'drag' ? [82, 236] : [86, 245];
    get('phone-trail').setAttribute('d', `M${trailStart.join(' ')}L${f.x} ${f.y}`);
    opacity('phone-trail', f.touch && scene.id !== 'type' ? .6 : 0);
    get('demo-cursor').setAttribute('transform', `translate(${f.cx} ${f.cy})`);
    get('demo-click').setAttribute('r', 9 + f.pulse * 22); opacity('demo-click', f.pulse * .7);
    get('demo-click').setAttribute('cx', f.cx); get('demo-click').setAttribute('cy', f.cy);
    get('demo-list').setAttribute('transform', `translate(0 ${-f.scroll})`);
    get('video-progress').setAttribute('width', 480 * f.progress);
    get('video-knob').setAttribute('cx', 52 + 480 * f.progress);
    opacity('video-play', f.playing ? 0 : 1); opacity('video-pause', f.playing ? 1 : 0);
    opacity('video-playing', f.playing ? 1 : 0); opacity('photo-open', f.photo ? 1 : 0); opacity('context-menu', f.menu ? 1 : 0);
    opacity('phone-keyboard', f.keyboard); opacity('phone-input', f.keyboard); opacity('phone-keyboard-icon', 1 - f.keyboard); opacity('phone-dismiss-icon', f.keyboard);
    opacity('phone-scroll-active', scene.id === 'scroll' && f.touch ? 1 : 0);
    get('phone-hold').setAttribute('stroke-dasharray', `${f.hold * 94} 94`); opacity('phone-hold', scene.id === 'right' && f.touch ? 1 : 0);
    setText('phone-draft', f.draft); setText('phone-candidate', time < .53 ? '周末' : '电影'); setText('mac-query', f.text || '搜索想看的电影');
    get('mac-query').setAttribute('fill', f.text ? '#293e30' : '#87917e');
    setText('video-time', scene.id === 'drag' ? (f.progress > .5 ? '01:06' : '00:22') : '00:22');
    setText('phone-action', scene.action); setText('mac-result', scene.result);
    root.style.setProperty('--demo-progress', time);
    steps.forEach((button, i) => { button.textContent = `${i + 1}. ${scene.steps[i]}`; button.setAttribute('aria-current', i === f.step ? 'step' : 'false'); });
  }
  function syncControls() {
    controls.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scene === scenes[index].id)));
    get('demo-pause').textContent = paused ? '播放演示' : '暂停';
    get('demo-pause').setAttribute('aria-pressed', String(paused));
  }
  function tick(now) {
    raf = null;
    if (paused || !inView || document.hidden) { last = 0; return; }
    if (last) time += Math.min(now - last, 100) / duration;
    last = now;
    if (time >= 1) { time = 0; index = (index + 1) % scenes.length; syncControls(); }
    paint(); raf = requestAnimationFrame(tick);
  }
  function resume() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null; last = 0;
    if (!paused && inView && !document.hidden) raf = requestAnimationFrame(tick);
  }
  controls.forEach(button => button.addEventListener('click', () => {
    index = scenes.findIndex(scene => scene.id === button.dataset.scene); time = reduced.matches ? .9 : 0;
    syncControls(); paint(); resume();
    if (!root.contains(button)) root.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' });
  }));
  steps.forEach(button => button.addEventListener('click', () => {
    paused = true; time = scenes[index].samples[Number(button.dataset.step)]; syncControls(); paint(); resume();
  }));
  get('demo-pause').addEventListener('click', () => { paused = !paused; syncControls(); resume(); });
  get('demo-replay').addEventListener('click', () => { time = reduced.matches ? .9 : 0; paused = reduced.matches; syncControls(); paint(); resume(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; syncControls(); resume(); });
  document.addEventListener('visibilitychange', resume);
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; resume(); }, { threshold: .1 }).observe(root);
  time = reduced.matches ? .9 : 0; syncControls(); paint();
  root.classList.add('demo-ready');
}
if (typeof document !== 'undefined') mountDemo();
