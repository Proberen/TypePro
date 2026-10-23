import { useCallback, useEffect, useId, useLayoutEffect, useState } from "react";
import "./appearance.css";

export interface AppearanceSettings {
  theme: "light" | "dark" | "system";
  accent: string;
  font: number;
}

const DEFAULTS: AppearanceSettings = { theme: "light", accent: "#74ade5", font: 17 };
const STORAGE_KEY = "typepro.appearance.v1";
const HEX = /^#[0-9a-f]{6}$/i;
const SWATCHES = [["#74ade5", "浅蓝"], ["#79c4b2", "薄荷"], ["#b2a0e4", "紫藤"], ["#e8b28b", "杏色"], ["#dfa0ad", "玫瑰"], ["#9aa8ba", "石灰"]] as const;

function normalize(input: Partial<AppearanceSettings>): AppearanceSettings {
  return {
    theme: input.theme === "dark" || input.theme === "system" ? input.theme : "light",
    accent: typeof input.accent === "string" && HEX.test(input.accent) ? input.accent.toLowerCase() : DEFAULTS.accent,
    font: typeof input.font === "number" && Number.isFinite(input.font) ? Math.max(14, Math.min(22, Math.round(input.font))) : DEFAULTS.font,
  };
}

function rgb(hex: string) { return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)); }
function mix(a: string, b: string, ratio: number) {
  const target = rgb(b);
  return `#${rgb(a).map((value, index) => Math.round(value * (1 - ratio) + target[index] * ratio).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(color: string) {
  const values = rgb(color).map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function useAppearance() {
  const [settings, setSettings] = useState<AppearanceSettings>(() => {
    try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {}); }
    catch { return { ...DEFAULTS }; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const resolvedTheme: "light" | "dark" = settings.theme === "dark" || (settings.theme === "system" && systemDark) ? "dark" : "light";
  useLayoutEffect(() => {
    const dark = resolvedTheme === "dark";
    const root = document.documentElement;
    const wash = mix(settings.accent, dark ? "#18212d" : "#ffffff", 0.88);
    let accentText = mix(settings.accent, dark ? "#ffffff" : "#123851", dark ? 0.22 : 0.4);
    const surfaces = dark ? ["#181e28", "#141a23", "#1c2430", wash] : ["#ffffff", "#f7f9fc", wash];
    for (let step = 0; step < 24 && surfaces.some(surface => contrast(accentText, surface) < 4.5); step++) {
      accentText = mix(accentText, dark ? "#ffffff" : "#000000", 0.12);
    }
    const onAccent = contrast(settings.accent, "#153652") >= 4.5 ? "#153652" : contrast(settings.accent, "#ffffff") >= 4.5 ? "#ffffff" : "#000000";
    root.dataset.theme = resolvedTheme;
    const variables = {
      "--accent": settings.accent,
      "--on-accent": onAccent,
      "--accent-text": accentText,
      "--accent-wash": wash,
      "--accent-ring": mix(settings.accent, dark ? "#304054" : "#ffffff", 0.48),
      "--document-font": `${settings.font}px`,
    };
    Object.entries(variables).forEach(([key, value]) => root.style.setProperty(key, value));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Preferences remain usable when storage is unavailable. */ }
  }, [settings, resolvedTheme]);
  const updateSettings = useCallback((patch: Partial<AppearanceSettings>) => setSettings(previous => normalize({ ...previous, ...patch })), []);
  const resetSettings = useCallback(() => setSettings({ ...DEFAULTS }), []);
  return { settings, updateSettings, resetSettings, resolvedTheme };
}

export interface ThemeSettingsProps {
  settings: AppearanceSettings;
  onChange: (patch: Partial<AppearanceSettings>) => void;
  onReset: () => void;
  onClose: () => void;
}

export default function ThemeSettings({ settings, onChange, onReset, onClose }: ThemeSettingsProps) {
  const id = useId();
  const [hex, setHex] = useState(settings.accent.toUpperCase());
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setHex(settings.accent.toUpperCase()); setInvalid(false); }, [settings.accent]);
  function chooseAccent(accent: string) { setHex(accent.toUpperCase()); setInvalid(false); onChange({ accent }); }
  return <section className="tp-appearance" aria-label="外观设置">
    <div className="tp-appearance-options">{([["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]] as const).map(([theme, label]) => <button key={theme} className={`tp-appearance-option ${settings.theme === theme ? "tp-active" : ""}`} type="button" aria-pressed={settings.theme === theme} onClick={() => onChange({ theme })}>
      <span className={`tp-appearance-thumb tp-${theme}`} aria-hidden="true"><span className="tp-mini-side" /><span className="tp-mini-lines"><i /><i /><i /><i /></span></span>{label}
    </button>)}</div>
    <h3 className="tp-settings-label">主题色</h3>
    <div className="tp-swatches">{SWATCHES.map(([color, name]) => <button className={`tp-swatch ${settings.accent.toLowerCase() === color ? "tp-active" : ""}`} key={color} style={{ backgroundColor: color, color }} type="button" aria-label={name} aria-pressed={settings.accent.toLowerCase() === color} onClick={() => chooseAccent(color)} />)}</div>
    <div className="tp-custom-color"><label htmlFor={`${id}-hex`}>自定义</label><div className="tp-color-field-wrap">
      <input id={`${id}-hex`} className={`tp-color-field ${invalid ? "tp-invalid" : ""}`} aria-label="主题色十六进制值" aria-invalid={invalid} aria-describedby={invalid ? `${id}-color-error` : undefined} value={hex} maxLength={7} spellCheck={false} onChange={event => {
        const value = event.target.value; setHex(value); setInvalid(false); if (HEX.test(value)) onChange({ accent: value });
      }} onBlur={() => setInvalid(!HEX.test(hex))} />
      <input className="tp-color-picker" type="color" aria-label="选择自定义主题色" value={settings.accent} onChange={event => chooseAccent(event.target.value)} />
    </div></div>
    {invalid && <p id={`${id}-color-error`} className="tp-field-error">请输入六位颜色值，如 #74ADE5</p>}
    <div className="tp-settings-divider" />
    <h3 className="tp-settings-label tp-preview-label">代码块预览</h3>
    <div className="tp-settings-preview"><pre><span className="tp-code-keyword">const</span>{" note = "}<span className="tp-code-string">'TypePro'</span>{";\nconsole."}<span className="tp-code-function">log</span>{"(note);\n"}<span className="tp-code-comment">// 让文字保持清晰</span></pre></div>
    <div className="tp-settings-divider" />
    <div className="tp-range-row"><label htmlFor={`${id}-font`}>正文字号</label><input id={`${id}-font`} type="range" min={14} max={22} value={settings.font} onChange={event => onChange({ font: Number(event.target.value) })} /><output htmlFor={`${id}-font`}>{settings.font}px</output></div>
    <footer className="tp-appearance-footer"><button className="tp-button tp-ghost" type="button" onClick={() => { setHex(DEFAULTS.accent.toUpperCase()); setInvalid(false); onReset(); }}>重置</button><button className="tp-button tp-primary" type="button" onClick={onClose}>完成</button></footer>
  </section>;
}
