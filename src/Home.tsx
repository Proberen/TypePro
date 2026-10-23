import { useRef, useState } from "react";
import { ArrowDownUp, CheckCircle2, ChevronRight, FileText, MoreHorizontal, Notebook, Palette, Plus, Search } from "lucide-react";
import type { Notebook as NotebookData } from "./lib/types";
import { readRecentDocuments } from "./lib/recent";
import { NotebookCover } from "./CoverPicker";
import "./appearance.css";

export interface HomeProps {
  notebooks: NotebookData[];
  onOpen: (bookId: string, docId?: string) => void;
  onCreate: () => void;
  onMenu: (bookId: string, anchor: HTMLElement) => void;
  onTheme: () => void;
  onTransfer: () => void;
  onMore: (anchor: HTMLElement) => void;
}

function dateLabel(value?: string, short = false) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = date.toDateString() === today.toDateString() ? "今天" : date.toDateString() === yesterday.toDateString() ? "昨天" : "";
  return day ? `${day}${short ? "" : ` ${time}`}` : date.toLocaleDateString("zh-CN", { ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }), month: "long", day: "numeric" });
}

export default function Home({ notebooks, onOpen, onCreate, onMenu, onTheme, onTransfer, onMore }: HomeProps) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const books = notebooks.filter(book => [book.name, ...book.documents.map(doc => doc.title)].join(" ").toLocaleLowerCase().includes(query));
  const documents = new Map(notebooks.flatMap(book => book.documents.map(doc => [doc.id, { book, doc }] as const)));
  const recent = readRecentDocuments().flatMap(entry => {
    const document = documents.get(entry.id);
    return document ? [{ ...document, openedAt: entry.openedAt }] : [];
  }).slice(0, 2);

  return <main className="tp-home">
    <header className="tp-home-header">
      <span className="tp-brand"><img src="/typepro-logo.png" alt="" /><span>TypePro</span></span>
      <div className="tp-header-actions">
        <button className="tp-icon-button" type="button" aria-label="外观" title="外观" onClick={onTheme}><Palette /></button>
        <button className="tp-icon-button tp-desktop-transfer" type="button" aria-label="导入 / 导出" title="导入 / 导出" onClick={onTransfer}><ArrowDownUp /></button>
        <button className="tp-icon-button" type="button" aria-label="更多" title="更多" onClick={event => onMore(event.currentTarget)}><MoreHorizontal /></button>
      </div>
    </header>
    <div className="tp-home-scroll">
      <div className="tp-home-content">
        <div className="tp-home-title"><h1>我的笔记</h1><button className="tp-button tp-primary" type="button" onClick={onCreate}><Plus />新建笔记</button></div>
        {notebooks.length ? <>
          <label className="tp-search-box"><Search aria-hidden="true" /><input ref={searchInput} placeholder="搜索笔记" aria-label="搜索笔记" value={search} onChange={event => setSearch(event.target.value)} /><kbd>搜索</kbd></label>
          {books.length ? <>
            <div className="tp-books-list">{books.map(book => {
              const updated = book.documents.reduce((last, doc) => doc.updatedAt > last ? doc.updatedAt : last, "");
              return <article className="tp-book-row" role="button" tabIndex={0} aria-label={`打开 ${book.name}`} key={book.id} onClick={() => onOpen(book.id)} onKeyDown={event => {
                if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(book.id); }
              }}>
                <NotebookCover cover={book.cover} className="tp-book-cover" />
                <div className="tp-book-info"><h2>{book.name}</h2><p>{book.documents.length ? book.documents.slice(0, 2).map(doc => doc.title).join(" · ") : "0 篇文档"}</p></div>
                <div className="tp-book-meta"><b>{book.documents.length} 篇文档</b><span>{dateLabel(updated)}</span></div>
                <button className="tp-icon-button tp-book-menu" type="button" aria-label={`${book.name} 操作`} title="笔记操作" onClick={event => { event.stopPropagation(); onMenu(book.id, event.currentTarget); }}><MoreHorizontal /></button>
                <ChevronRight className="tp-book-chevron" aria-hidden="true" />
              </article>;
            })}</div>
            {!query && recent.length > 0 && <section className="tp-recent"><h2>最近打开</h2>{recent.map(({ book, doc, openedAt }) => <button className="tp-recent-row" key={doc.id} type="button" onClick={() => onOpen(book.id, doc.id)}>
              <FileText aria-hidden="true" /><span className="tp-recent-name">{doc.title}</span><span className="tp-recent-parent">{book.name}</span><span className="tp-recent-time">{dateLabel(openedAt, true)}</span><ChevronRight aria-hidden="true" />
            </button>)}</section>}
          </> : <section className="tp-empty tp-search-empty"><div className="tp-empty-mark"><Search /></div><h2>没有找到相关笔记</h2><button className="tp-button tp-ghost tp-small" type="button" onClick={() => { setSearch(""); searchInput.current?.focus(); }}>清空搜索</button></section>}
        </> : <section className="tp-empty"><div className="tp-empty-mark"><Notebook /></div><h2>从第一本笔记开始</h2><p>为想法留一个地方。</p><button className="tp-button tp-primary" type="button" onClick={onCreate}><Plus />新建笔记</button><button className="tp-button tp-ghost tp-small" type="button" onClick={onTransfer}>导入已有笔记</button></section>}
      </div>
    </div>
    <footer className="tp-home-status"><CheckCircle2 aria-hidden="true" />本地保存</footer>
  </main>;
}
