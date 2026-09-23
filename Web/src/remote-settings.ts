export type RemoteSettings = { pointer: number; scroll: number; natural: boolean; keepAwake: boolean };
export function readSettings(value: unknown): RemoteSettings | undefined {
  if (!value || typeof value !== 'object') return;
  const settings = value as RemoteSettings;
  if (typeof settings.pointer !== 'number' || !Number.isFinite(settings.pointer) || settings.pointer < 0.2 || settings.pointer > 5
    || typeof settings.scroll !== 'number' || !Number.isFinite(settings.scroll) || settings.scroll < 0.05 || settings.scroll > 5
    || typeof settings.natural !== 'boolean' || typeof settings.keepAwake !== 'boolean') return;
  return { pointer: settings.pointer, scroll: settings.scroll, natural: settings.natural, keepAwake: settings.keepAwake };
}
