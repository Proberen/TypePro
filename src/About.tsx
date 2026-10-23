import { useId, useState } from "react";
import { version } from "../package.json";
import { RELEASES, UPGRADE_NOTES } from "./releases";
import "./appearance.css";

export default function About({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"releases" | "upgrade">("releases");
  const id = useId();
  return <section className="tp-about" aria-label="关于 TypePro">
    <div className="tp-about-brand"><img src="/typepro-logo.png" alt="" /><div><strong>TypePro</strong><span>版本 {version}</span></div></div>
    <div className="tp-about-tabs" role="tablist" aria-label="版本信息" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "releases" : event.key === "End" ? "upgrade" : tab === "releases" ? "upgrade" : "releases";
      setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    }}>
      {([["releases", "更新记录"], ["upgrade", "升级说明"]] as const).map(([key, label]) => <button type="button" key={key} id={`${id}-${key}`} data-tab={key} role="tab" aria-selected={tab === key} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} className={tab === key ? "tp-active" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div id={`${id}-panel`} className="tp-about-panel" role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0}>
      {tab === "releases" ? RELEASES.map(release => <article className="tp-release" key={release.version}><h3>{release.version}{release.version === version && <span>当前版本</span>}</h3><ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul></article>) : UPGRADE_NOTES.map(note => <article className="tp-upgrade-note" key={note.title}><h3>{note.title}</h3><p>{note.text}</p></article>)}
    </div>
    <footer className="tp-about-footer"><button className="tp-button tp-primary" type="button" onClick={onClose}>完成</button></footer>
  </section>;
}
