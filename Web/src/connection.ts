import type { Action } from './gesture.js';

export type ConnectionState = 'connecting' | 'connected' | 'permission' | 'unpaired' | 'busy' | 'paused' | 'offline' | 'error';
type Update = { state: ConnectionState; detail: string; name?: string; rtt?: number; doubleClickMs?: number; preview?: boolean };
export type PasteOutcome = 'executed' | 'uncertain' | 'not_sent' | 'permission' | 'clipboard_failed' | 'unavailable' | 'busy' | 'too_large' | 'expired' | 'id_conflict' | 'limit';
const reasons: Record<string, string> = {
  busy: '另一台手机或标签页正在控制。请先断开它，再重试。',
  revoked: '此浏览器的配对已移除，请在 Mac 上重新开启配对。',
  unpaired: '在 Mac 菜单栏打开 SofaPad，开启配对并扫码。',
  host_disconnect: 'Mac 已主动断开。需要时点击重新连接。',
  host_paused: 'Mac 已锁屏或进入睡眠。解锁后点击重新连接。',
  host_stopped: 'Mac 已关闭控制服务。开启后点击重新连接。',
  version: '页面版本与 Mac 不一致，请刷新页面。',
  protocol: '连接数据异常，已停止控制。请刷新后重试。',
};

export class ConnectionClient {
  private socket?: WebSocket;
  private sessionID?: string;
  private seq = 0;
  private generation = 0;
  private manual = false;
  private hidden = false;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private pings = new Map<string, number>();
  private lastPong = 0;
  private ready = false;
  private permitted = false;
  private supportsBackspace = false;
  private name = '你的 Mac';
  private pasteEpoch?: string;
  private pendingPaste?: { id: string; sent: boolean; resolve: (result: PasteOutcome) => void; timer: ReturnType<typeof setTimeout> };
  constructor(private update: (update: Update) => void, private cancelGesture: () => void) {}
  get enabled() { return this.ready && this.permitted; }
  get canBackspace() { return this.enabled && this.supportsBackspace && !this.pendingPaste; }
  backspace() {
    if (!this.canBackspace) return false;
    return this.transmit({ type: 'backspace' });
  }

  async connect(pairToken?: string) {
    if (this.hidden) return;
    this.manual = false; this.clear();
    const generation = this.generation;
    this.update({ state: 'connecting', detail: pairToken ? '正在与 Mac 配对…' : '正在连接 Mac…' });
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 4000);
    try {
      if (pairToken) {
        const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: pairToken, name: /iPhone/.test(navigator.userAgent) ? 'iPhone Safari' : '网页浏览器' }), signal: abort.signal });
        if (!response.ok) {
          if (generation !== this.generation) return;
          this.manual = true;
          this.update({ state: 'unpaired', detail: response.status === 429 ? '配对尝试过多，请等待一分钟。' : '二维码已使用或过期。请在 Mac 上重新开启配对并扫码。' }); return;
        }
      }
      const response = await fetch('/api/status', { cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error('status');
      const status = await response.json();
      if (generation !== this.generation) return;
      this.name = status.name;
      this.update({ state: 'connecting', detail: '正在建立控制连接…', name: this.name, preview: status.preview });
      if (!status.authenticated) { this.manual = true; this.update({ state: 'unpaired', detail: reasons.unpaired }); return; }
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      this.socket = socket;
      this.deadline = setTimeout(() => { if (!this.ready && generation === this.generation) this.fail(); }, 5000);
      socket.onopen = () => { if (generation === this.generation) socket.send(JSON.stringify({ type: 'hello', v: 2 })); };
      socket.onmessage = event => { if (generation === this.generation) this.receive(event.data); };
      socket.onerror = () => { /* close is the single recovery path */ };
      socket.onclose = () => { if (generation === this.generation) this.fail(); };
    } catch {
      if (generation === this.generation) this.fail();
    } finally { clearTimeout(timeout); }
  }
  send(action: Action) {
    if (!this.enabled) return;
    if (action.type === 'click') { this.transmit(action); return; }
    const chunks = Math.max(1, Math.ceil(Math.max(Math.abs(action.dx), Math.abs(action.dy)) / 1800));
    for (let i = 0; i < chunks; i++) {
      this.transmit({ ...action, dx: action.dx / chunks, dy: action.dy / chunks,
        ...(action.type !== 'move' ? { phase: action.phase === 'begin' && i > 0 ? 'update' : action.phase } : {}) });
    }
  }
  private transmit(value: Record<string, unknown>) {
    if (!this.ready || !this.sessionID || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > 8192) { this.fail(); return false; }
    try { this.socket.send(JSON.stringify({ ...value, v: 2, sessionID: this.sessionID, seq: ++this.seq })); return true; }
    catch { this.fail(); return false; }
  }
  paste(text: string): Promise<PasteOutcome> {
    if (this.pendingPaste) return Promise.resolve('busy');
    if (!text || !this.enabled || !this.pasteEpoch) return Promise.resolve('not_sent');
    if (new TextEncoder().encode(text).length > 12000) return Promise.resolve('too_large');
    const random = crypto.getRandomValues(new Uint8Array(16));
    const requestID = this.pasteEpoch + ':' + [...random].map(b => b.toString(16).padStart(2, '0')).join('');
    const value = { type: 'paste', text, requestID };
    if (new TextEncoder().encode(JSON.stringify({ ...value, v: 2, sessionID: this.sessionID, seq: this.seq + 1 })).length > 16384) return Promise.resolve('too_large');
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finishPaste('uncertain'), 6000);
      this.pendingPaste = { id: requestID, resolve, timer, sent: false };
      const sent = this.transmit(value);
      if (this.pendingPaste) {
        this.pendingPaste.sent = sent;
        if (!sent) this.finishPaste('not_sent');
      }
    });
  }
  private finishPaste(result: PasteOutcome) {
    const pending = this.pendingPaste; this.pendingPaste = undefined;
    if (pending) { clearTimeout(pending.timer); pending.resolve(result); }
  }
  private receive(raw: string) {
    let message;
    try { message = JSON.parse(raw); } catch { this.fail(); return; }
    if (message.type === 'ready' && message.v === 2 && typeof message.sessionID === 'string') {
      this.ready = true; this.sessionID = message.sessionID; this.seq = 0; this.attempt = 0;
      this.supportsBackspace = Array.isArray(message.capabilities) && message.capabilities.includes('backspace');
      this.pasteEpoch = message.pasteEpoch;
      this.lastPong = performance.now(); clearTimeout(this.deadline);
      this.setPermission(message.permitted === true);
      this.update({ state: this.permitted ? 'connected' : 'permission', detail: this.permitted ? '可以开始操作' : '请在 Mac 上授予 SofaPad 辅助功能权限。',
        name: message.name, doubleClickMs: Math.min(2000, Math.max(100, message.doubleClickInterval * 1000)), preview: message.preview });
      this.heartbeat = setInterval(() => {
        if (performance.now() - this.lastPong > 6000) { this.fail(); return; }
        const nonce = String(performance.now()); this.pings.set(nonce, performance.now());
        this.transmit({ type: 'ping', nonce });
      }, 2000);
    } else if (message.type === 'pong') {
      const began = this.pings.get(message.nonce);
      if (began !== undefined) {
        this.lastPong = performance.now(); this.pings.clear();
        this.update({ state: this.permitted ? 'connected' : 'permission', detail: this.permitted ? '可以开始操作' : '请在 Mac 上授予辅助功能权限。', rtt: Math.round(performance.now() - began) });
      }
    } else if (message.type === 'pasteResult' && message.requestID === this.pendingPaste?.id) {
      const statuses: PasteOutcome[] = ['executed', 'permission', 'clipboard_failed', 'unavailable', 'busy', 'expired', 'id_conflict', 'limit'];
      this.finishPaste(statuses.includes(message.status) ? message.status : 'uncertain');
    } else if (message.type === 'status') { this.setPermission(message.permitted === true);
    } else if (message.type === 'disconnect') {
      const reason = message.reason as string;
      if (['host_paused', 'host_stopped'].includes(reason)) { this.fail();
      } else if (reasons[reason]) {
        this.manual = true; this.clear();
        this.update({ state: reason === 'busy' ? 'busy' : ['unpaired', 'revoked'].includes(reason) ? 'unpaired' : 'paused', detail: reasons[reason] });
      } else { this.fail(); }
    }
  }
  private setPermission(value: boolean) {
    if (!value) this.cancelGesture();
    this.permitted = value;
    this.update({ state: value ? 'connected' : 'permission', detail: value ? '可以开始操作' : '请在 Mac 上授予 SofaPad 辅助功能权限。' });
  }
  disconnect() {
    this.transmit({ type: 'disconnect' }); this.manual = true; this.clear();
    this.update({ state: 'paused', detail: '已断开，需要时点击重新连接。' });
  }
  async forget() {
    this.disconnect();
    try {
      const response = await fetch('/api/forget', { method: 'POST', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('forget');
      this.update({ state: 'unpaired', detail: '已忘记此 Mac。再次使用时请重新扫码配对。' });
    } catch { this.update({ state: 'error', detail: '无法联系 Mac，尚未移除配对。请重试或在 Mac 端移除此浏览器。' }); }
  }
  visibility(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) { this.transmit({ type: 'disconnect' }); this.clear(); }
    else if (!this.manual) { void this.connect(); }
  }
  networkChanged() { if (!this.hidden && !this.manual) void this.connect(); }
  private clear() {
    this.finishPaste(this.pendingPaste?.sent ? 'uncertain' : 'not_sent'); this.pasteEpoch = undefined;
    this.generation++; this.ready = false; this.permitted = false; this.sessionID = undefined;
    this.supportsBackspace = false;
    this.cancelGesture(); clearTimeout(this.retry); clearTimeout(this.deadline); clearInterval(this.heartbeat); this.pings.clear();
    const socket = this.socket; this.socket = undefined;
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.close(); }
  }
  private fail() {
    this.clear();
    if (this.hidden || this.manual) return;
    this.update({ state: 'offline', detail: '连接中断。请确认 Mac 已唤醒，手机与 Mac 在同一网络。' });
    const delay = Math.min(10_000, 1000 * 2 ** Math.min(this.attempt++, 4)) + Math.random() * 300;
    this.retry = setTimeout(() => { void this.connect(); }, delay);
  }
}
