import { Download, X } from "lucide-react";
import type { AppUpdatesController } from "./types";
import "./updates.css";

export default function AppUpdateNotice({ updates, onDetails }: { updates: AppUpdatesController; onDetails: () => void }) {
  if (!updates.visible || !updates.state.update) return null;
  return <aside className="tp-app-update-notice" role="status" aria-live="polite">
    <Download size={17} aria-hidden="true" />
    <span>TypePro {updates.state.update.version} 可更新</span>
    <button type="button" className="tp-app-update-link" onClick={onDetails}>查看更新</button>
    <button type="button" className="icon-button" aria-label="关闭更新提示" onClick={updates.dismiss}><X size={15} /></button>
  </aside>;
}
