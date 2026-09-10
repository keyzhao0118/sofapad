import type { PasteOutcome } from './connection.js';

export const pasteMessages: Record<PasteOutcome, string> = {
  executed: '粘贴指令已执行', uncertain: '请查看电视确认是否已粘贴',
  not_sent: '尚未发送，请连接 Mac 后重试', permission: '请在 Mac 上授予辅助功能权限',
  clipboard_failed: 'Mac 剪贴板写入失败，未执行粘贴', unavailable: '粘贴指令未执行，请在 Mac 上检查权限',
  busy: '请等待当前操作完成', too_large: '文字过长，请缩短后重试（不会自动截断）',
  expired: 'Mac 已重新启动，请确认电视内容后重新发送', id_conflict: '请求编号冲突，未再次执行',
  limit: '本次服务的文本请求已达上限，请重新启动 Mac 服务进程',
};

/** A draft stays in the textarea. IME completion is read on the following task,
 * after the final input event, never from the candidate/composition buffer. */
export class TextSubmission {
  composing = false;
  private queued = false;
  private sending = false;
  private commitTimer?: ReturnType<typeof setTimeout>;
  get pending() { return this.queued || this.sending; }
  constructor(private read: () => string, private send: (text: string) => Promise<PasteOutcome>,
    private update: (message: string) => void) {}
  compositionStart() { this.composing = true; }
  compositionEnd() {
    this.composing = false;
    if (this.queued) this.commitTimer = setTimeout(() => { this.queued = false; void this.submit(); }, 0);
  }
  async submit() {
    if (this.pending) return;
    if (this.composing) { this.queued = true; this.update('请完成选词后粘贴'); return; }
    const text = this.read(); if (!text) return;
    this.sending = true; this.update('正在发送…');
    try { this.update(pasteMessages[await this.send(text)]); }
    catch { this.update(pasteMessages.uncertain); }
    finally { this.sending = false; this.update(''); }
  }
  cancelQueued() { this.queued = false; clearTimeout(this.commitTimer); this.update(''); }
}
