import { useCallback, useEffect, useRef, useState } from "react";
import { loadWorkspace, saveWorkspace } from "./bridge";
import type { Workspace } from "./types";

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const current = useRef<Workspace | null>(null);
  const [status, setStatus] = useState<
    "loading" | "saved" | "saving" | "error"
  >("loading");
  const [error, setError] = useState("");
  const revision = useRef(0),
    savedRevision = useRef(0),
    queuedRevision = useRef(-1);
  const tail = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!current.current || revision.current <= savedRevision.current)
      return tail.current;
    const version = revision.current;
    if (queuedRevision.current === version) return tail.current;
    queuedRevision.current = version;
    const snapshot = current.current;
    setStatus("saving");
    const write = tail.current
      .catch(() => {})
      .then(() => saveWorkspace(snapshot));
    tail.current = write.then(
      () => {
        savedRevision.current = version;
        if (version === revision.current) {
          setStatus("saved");
          setError("");
        }
      },
      (e) => {
        queuedRevision.current = -1;
        setStatus("error");
        setError(String(e));
        throw e;
      },
    );
    return tail.current;
  }, []);

  const update = useCallback(
    (fn: (old: Workspace) => Workspace) => {
      if (!current.current) return;
      const next = fn(current.current);
      current.current = next;
      setWorkspace(next);
      revision.current++;
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, 250);
    },
    [flush],
  );

  const replacePersisted = useCallback((next: Workspace) => {
    current.current = next;
    setWorkspace(next);
    revision.current++;
    savedRevision.current = revision.current;
    queuedRevision.current = -1;
    setStatus("saved");
    setError("");
  }, []);

  useEffect(() => {
    let alive = true;
    void loadWorkspace().then(
      (value) => {
        if (alive) replacePersisted(value);
      },
      (e) => {
        if (alive) {
          setStatus("error");
          setError(String(e));
        }
      },
    );
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [replacePersisted]);
  return { workspace, current, update, flush, replacePersisted, status, error };
}
