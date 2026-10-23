import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  MoreHorizontal,
  Plus,
  Puzzle,
  ArrowDownUp,
} from "lucide-react";
import { useState } from "react";
import type { Notebook } from "./lib/types";

interface Props {
  notebooks: Notebook[];
  activeId: string | null;
  onSelect: (notebookId: string, documentId?: string) => void;
  onCreate: () => void;
  onMenu: (notebookId: string, documentId?: string) => void;
  onTransfer: () => void;
  onPlugins: () => void;
}
export default function Sidebar(props: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <h1>笔记本</h1>
        <button
          className="icon-button add-button"
          title="新建"
          aria-label="新建"
          onClick={props.onCreate}
        >
          <Plus size={20} />
        </button>
      </div>
      <nav className="notebook-tree" aria-label="笔记本和文档">
        {props.notebooks.map((book) => (
          <div className="notebook-group" key={book.id}>
            <div className="tree-row notebook-row">
              <button
                className="tree-label"
                onClick={() => {
                  setCollapsed((old) => {
                    const next = new Set(old);
                    next.has(book.id)
                      ? next.delete(book.id)
                      : next.add(book.id);
                    return next;
                  });
                  props.onSelect(book.id);
                }}
                aria-expanded={!collapsed.has(book.id)}
              >
                {collapsed.has(book.id) ? (
                  <ChevronRight size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
                <Folder size={20} />
                <span>{book.name}</span>
              </button>
              <button
                className="icon-button row-menu"
                aria-label={`${book.name}的操作`}
                onClick={() => props.onMenu(book.id)}
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
            {!collapsed.has(book.id) &&
              book.documents.map((doc) => (
                <div
                  className={`tree-row document-row ${doc.id === props.activeId ? "active" : ""}`}
                  key={doc.id}
                >
                  <button
                    className="tree-label"
                    aria-current={
                      doc.id === props.activeId ? "page" : undefined
                    }
                    onClick={() => props.onSelect(book.id, doc.id)}
                  >
                    <FileText size={18} />
                    <span>{doc.title}</span>
                  </button>
                  <button
                    className="icon-button row-menu"
                    aria-label={`${doc.title}的操作`}
                    onClick={() => props.onMenu(book.id, doc.id)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </div>
              ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button onClick={props.onTransfer}>
          <ArrowDownUp size={19} />
          <span>导入 / 导出</span>
        </button>
        <button onClick={props.onPlugins}>
          <Puzzle size={19} />
          <span>插件</span>
        </button>
      </div>
    </aside>
  );
}
