import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedTrace } from "./core/types";
import { parseTraceText } from "./core/parse";
import { searchTrace, errorSpanIds, slowestSpanId } from "./core/search";
import { decodeShare, readShareHash, shareSupported } from "./core/share";
import { ThemeProvider } from "./theme/ThemeProvider";
import { Loader } from "./components/Loader";
import { AppShell } from "./components/shell/AppShell";
import { copyShareLinkToClipboard } from "./components/shell/exportActions";
import { TreeView } from "./components/views/TreeView/TreeView";
import { FlamegraphView } from "./components/views/FlamegraphView";
import { DiffView } from "./components/views/DiffView";
import { SpanDetail } from "./components/detail/SpanDetail";
import { DEFAULT_VIEW, type ViewId } from "./lib/views";
import { useLiveWatch } from "./hooks/useLiveWatch";
import { useConversations } from "./hooks/useConversations";
import { pickFolder } from "./lib/folderWatch";
import { latestSpanId } from "./core/live";
import { LiveBar } from "./components/live/LiveBar";
import { LiveStandby } from "./components/live/LiveStandby";
import { BackToLivePill } from "./components/live/BackToLivePill";
import { ConversationList } from "./components/live/ConversationList";
import type { LiveUpdate } from "./lib/liveEngine";
import { useAnnotations } from "./hooks/useAnnotations";
import { AnnotationsView } from "./components/views/AnnotationsView";
import type { Annotation } from "./core/annotations";

export default function App() {
  const [trace, setTrace] = useState<ParsedTrace | null>(null);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [rawSource, setRawSource] = useState("");
  const [folderDir, setFolderDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderView, setFolderView] = useState<"list" | "trace">("list");
  const [following, setFollowing] = useState(true);
  const [displayedFile, setDisplayedFile] = useState("");
  const [pendingRun, setPendingRun] = useState<LiveUpdate | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const convo = useConversations(folderDir);
  const live = folderDir !== null && folderView === "trace";

  const ann = useAnnotations(label);
  const knownTags = useMemo(
    () =>
      [...new Set(Object.values(ann.annotations).map((a) => a.tag).filter((t): t is string => !!t))],
    [ann.annotations],
  );

  const onLoad = (t: ParsedTrace, lbl: string, source: string) => {
    setTrace(t);
    setLabel(lbl);
    setRawSource(source);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setActiveView(DEFAULT_VIEW);
    setError(null);
    setQuery("");
    setMatchIndex(0);
  };

  const onLiveUpdate = useCallback(
    (u: LiveUpdate) => {
      setTrace(u.trace);
      setError(null);
      if (following) {
        setLabel(u.label);
        setRawSource(u.source);
        setDisplayedFile(u.label);
        setSelectedId(latestSpanId(u.trace.roots));
        setPendingRun(null);
      } else if (u.label === displayedFile) {
        setLabel(u.label);
        setRawSource(u.source);
      } else {
        setPendingRun(u);
      }
    },
    [following, displayedFile],
  );

  const liveWatch = useLiveWatch({ onUpdate: onLiveUpdate });

  // Clear trace-view state before opening a different conversation.
  const resetTraceState = useCallback(() => {
    setTrace(null);
    setSelectedId(null);
    setFollowing(true);
    setPendingRun(null);
    setDisplayedFile("");
    setQuery("");
    setMatchIndex(0);
    setActiveView("tree");
  }, []);

  const openFolder = useCallback(async () => {
    const dir = await pickFolder();
    if (!dir) return;
    setFolderDir(dir);
    setFolderView("list");
  }, []);

  const openConversation = useCallback(
    (name: string) => {
      if (!folderDir) return;
      resetTraceState();
      setFolderView("trace");
      liveWatch.watchFile(folderDir, name);
    },
    [folderDir, liveWatch, resetTraceState],
  );

  const followNewest = useCallback(() => {
    if (!folderDir) return;
    resetTraceState();
    setFolderView("trace");
    liveWatch.followNewest(folderDir);
  }, [folderDir, liveWatch, resetTraceState]);

  const backToList = useCallback(() => {
    liveWatch.stop();
    setFolderView("list");
  }, [liveWatch]);

  const reset = () => {
    liveWatch.stop();
    setFolderDir(null);
    setFolderView("list");
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
    setActiveView(DEFAULT_VIEW);
    setQuery("");
    setMatchIndex(0);
    setRawSource("");
    setFollowing(true);
    setPendingRun(null);
    setDisplayedFile("");
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  };

  const search = useMemo(
    () => (trace ? searchTrace(trace.roots, query) : null),
    [trace, query],
  );
  const errors = useMemo(() => (trace ? errorSpanIds(trace.roots) : []), [trace]);
  const matchCount = search?.orderedMatchIds.length ?? 0;

  const onQueryChange = useCallback(
    (q: string) => {
      setQuery(q);
      setMatchIndex(0);
      if (trace) {
        const res = searchTrace(trace.roots, q);
        if (res.orderedMatchIds.length > 0) setSelectedId(res.orderedMatchIds[0]);
      }
    },
    [trace],
  );

  const stepMatch = useCallback(
    (delta: number) => {
      const ids = search?.orderedMatchIds ?? [];
      if (ids.length === 0) return;
      setMatchIndex((prev) => {
        const next = (prev + delta + ids.length) % ids.length;
        setSelectedId(ids[next]);
        return next;
      });
    },
    [search],
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    setMatchIndex(0);
  }, []);

  const jumpNextError = useCallback(() => {
    if (errors.length === 0) return;
    const cur = errors.indexOf(selectedId ?? "");
    setSelectedId(errors[(cur + 1) % errors.length]);
  }, [errors, selectedId]);

  const jumpSlowest = useCallback(() => {
    if (!trace) return;
    const id = slowestSpanId(trace.roots);
    if (id) setSelectedId(id);
  }, [trace]);

  const canShare = shareSupported();

  const copyShareLink = useCallback(async () => {
    return copyShareLinkToClipboard({
      rawSource,
      label,
      baseUrl: window.location.origin + window.location.pathname,
      writeText: (text) => navigator.clipboard.writeText(text),
    });
  }, [rawSource, label]);

  const downloadJson = useCallback(() => {
    if (!rawSource) return;
    const blob = new Blob([rawSource], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label || "trace"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [rawSource, label]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On first load, open a trace embedded in the URL hash (#t=...).
  useEffect(() => {
    const token = readShareHash(window.location.hash);
    if (!token) return;
    let cancelled = false;
    decodeShare(token)
      .then((payload) => {
        if (cancelled) return;
        onLoad(parseTraceText(payload.source), payload.name, payload.source);
      })
      .catch(() => {
        if (!cancelled) setError("This share link could not be opened.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goLive = useCallback(() => {
    setFollowing(true);
    if (pendingRun) {
      const u = pendingRun;
      setTrace(u.trace);
      setLabel(u.label);
      setRawSource(u.source);
      setDisplayedFile(u.label);
      setSelectedId(latestSpanId(u.trace.roots));
      setPendingRun(null);
    } else if (trace) {
      setSelectedId(latestSpanId(trace.roots));
    }
  }, [pendingRun, trace]);

  const onSpanSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (live) setFollowing(false);
    },
    [live],
  );

  const onUserScroll = useCallback(() => {
    if (live && following) setFollowing(false);
  }, [live, following]);

  const onAnnotationSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setActiveView("tree");
      if (live) setFollowing(false);
    },
    [live],
  );

  const selected = selectedId ? (trace?.byId.get(selectedId) ?? null) : null;
  const filtering = query.trim().length > 0;
  const currentMatchId =
    matchCount > 0 ? (search?.orderedMatchIds[matchIndex] ?? null) : null;

  return (
    <ThemeProvider>
      {folderDir && folderView === "list" ? (
        <ConversationList
          folderName={folderDir.name}
          conversations={convo.conversations}
          loading={convo.loading}
          error={convo.error}
          onOpen={openConversation}
          onFollowNewest={followNewest}
          onClose={reset}
        />
      ) : !trace ? (
        live ? (
          <LiveStandby
            state={liveWatch.state}
            folderName={liveWatch.folderName}
            onStop={backToList}
          />
        ) : (
          <Loader onLoad={onLoad} onError={setError} error={error} onStartLive={openFolder} />
        )
      ) : (
        <AppShell
          activeView={activeView}
          onSelectView={setActiveView}
          label={label}
          summary={trace.summary}
          onReset={reset}
          exportActions={{ onCopyLink: copyShareLink, onDownloadJson: downloadJson, canShare }}
          search={{
            query,
            onQueryChange,
            matchCount,
            matchPosition: matchCount > 0 ? matchIndex + 1 : 0,
            onPrev: () => stepMatch(-1),
            onNext: () => stepMatch(1),
            onClear: clearSearch,
            inputRef: searchInputRef,
            onJumpNextError: jumpNextError,
            onJumpSlowest: jumpSlowest,
            errorCount: errors.length,
            active: activeView === "tree",
          }}
        >
          <section className="relative flex min-h-0 flex-col overflow-hidden border-r border-border bg-panel">
            {live && (
              <LiveBar
                state={liveWatch.state}
                folderName={liveWatch.folderName}
                currentFile={liveWatch.currentFile}
                onStop={backToList}
              />
            )}
            {activeView === "tree" && (
              <TreeView
                trace={trace}
                selectedId={selectedId}
                onSelect={onSpanSelect}
                filtering={filtering}
                visibleIds={search?.visibleIds ?? null}
                matchIds={search?.matchIds ?? null}
                currentMatchId={currentMatchId}
                query={query}
                followId={live && following ? selectedId : null}
                onUserScroll={onUserScroll}
                annotations={ann.annotations}
              />
            )}
            {activeView === "flamegraph" && (
              <FlamegraphView trace={trace} selectedId={selectedId} onSelect={onSpanSelect} />
            )}
            {activeView === "diff" && <DiffView trace={trace} label={label} />}
            {activeView === "annotations" && (
              <AnnotationsView annotations={ann.annotations} label={label} onSelect={onAnnotationSelect} />
            )}
            {live && !following && (
              <BackToLivePill newRun={pendingRun !== null} onClick={goLive} />
            )}
          </section>
          <aside className="min-h-0 overflow-auto bg-bg">
            {selected ? (
              <SpanDetail
                node={selected}
                annotation={ann.annotations[selected.spanId]}
                onAnnotate={(a: Annotation) => ann.setAnnotation(selected, a)}
                knownTags={knownTags}
              />
            ) : (
              <div className="p-6 text-sm text-muted">Select a span to inspect it.</div>
            )}
          </aside>
        </AppShell>
      )}
    </ThemeProvider>
  );
}
