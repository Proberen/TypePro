import { useEffect, useState, type CSSProperties } from "react";
import { Check, ImagePlus, Notebook } from "lucide-react";
import { resolveAsset } from "./lib/bridge";
import "./appearance.css";

export function NotebookCover({ cover, className = "" }: { cover?: string; className?: string }) {
  const [asset, setAsset] = useState<{ path: string; url: string } | null>(null);
  const preset = /^preset:([0-5])$/.exec(cover || "");
  const local = cover?.startsWith("../../assets/") ? cover : null;
  useEffect(() => {
    if (!local) return;
    let active = true;
    resolveAsset(local).then(url => { if (active) setAsset({ path: local, url }); }).catch(() => { if (active) setAsset(null); });
    return () => { active = false; };
  }, [local]);
  const url = local && asset?.path === local ? asset.url : null;
  const index = preset ? Number(preset[1]) : 0;
  const style: CSSProperties | undefined = preset ? {
    backgroundImage: 'url("/covers/typepro-covers.png")',
    backgroundSize: "300% 200%",
    backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 100}%`,
  } : undefined;
  return <span className={`tp-notebook-cover ${className}`} style={style} aria-hidden="true">
    {url ? <img src={url} alt="" /> : !preset && <Notebook />}
  </span>;
}

export interface CoverPickerProps {
  value: string;
  onChange: (value: string) => void;
  onUpload: () => Promise<string | null>;
}

export default function CoverPicker({ value, onChange, onUpload }: CoverPickerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    setBusy(true); setError("");
    try { const path = await onUpload(); if (path) onChange(path); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="tp-cover-picker" aria-label="笔记图片">
    <div className="tp-cover-heading"><span>笔记图片</span><button className="tp-button tp-outline tp-small" type="button" disabled={busy} onClick={upload}><ImagePlus />{busy ? "上传中…" : "上传图片"}</button></div>
    <div className="tp-cover-grid">{Array.from({ length: 6 }, (_, index) => <button key={index} className={`tp-cover-option ${value === `preset:${index}` ? "tp-selected" : ""}`} type="button" disabled={busy} aria-label={`内置图片 ${index + 1}`} aria-pressed={value === `preset:${index}`} onClick={() => { setError(""); onChange(`preset:${index}`); }}>
      <NotebookCover cover={`preset:${index}`} />{value === `preset:${index}` && <span className="tp-cover-check"><Check /></span>}
    </button>)}</div>
    {value.startsWith("../../assets/") && <div className="tp-custom-cover"><NotebookCover cover={value} /><span>自定义图片</span><Check aria-label="已选择" /></div>}
    {error && <p className="tp-field-error" role="alert">{error}</p>}
  </section>;
}
