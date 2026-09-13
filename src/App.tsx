import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParsedTrace } from "./core/types";
import { parseTraceText } from "./core/parse";
import { decodeShare, readShareHash } from "./core/share";
import { ThemeProvider } from "./theme/ThemeProvider";
import { Loader } from "./components/Loader";
import { AppShell } from "./components/shell/AppShell";
import { useExportReview } from "./hooks/useExportReview";
import { useTraceSearch } from "./hooks/useTraceSearch";
import { browserSessionSummary } from "./core/session/browserSummary";
import { SharePreviewDialog } from "./components/shell/SharePreviewDialog";
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
import { FolderBrowser } from "./components/live/FolderBrowser";
import { useFailedScan } from "./hooks/useFailedScan";
import { aggregateDashboard } from "./core/folderStats";
import type { LiveUpdate } from "./lib/liveEngine";
import { useAnnotations } from "./hooks/useAnnotations";
import { AnnotationsView } from "./components/views/AnnotationsView";
import type { Annotation } from "./core/annotations";
import { createViewerClient, readViewerToken } from "./core/viewerTransport";
import type { SessionSummary } from "./core/session/types";
import { SessionOverview } from "./components/session/SessionOverview";
import { SessionPicker, type SessionPickerMemory } from "./components/session/SessionPicker";
import { EMPTY_SESSION_FILTERS } from "./components/session/SessionFilters";
import {
  clearSessionNavigation,
  completeSessionRequest,
  createSessionNavigation,
  failSessionRequest,
  isCurrentSessionRequest,
  localSessionRoute,
  sessionEventSelection,
  sessionAnnotationKey,
  sessionLocationForEvent,
  sessionLocationForReset,
  sessionLocationForSelection,
  setLoadedSessionRoute,
  shouldPreferLocalSession,
  startSessionRequest,
} from "./core/session/navigation";

export default function App() {
  const [trace, setTrace] = useState<ParsedTrace | null>(null);
  const [label, setLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);
  const [rawSource, setRawSource] = useState("");
  const { exportReview, closeExport, reviewExport, canShare } = useExportReview(rawSource, setError);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [shareRevision, setShareRevision] = useState(0);
  const [folderDir, setFolderDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderView, setFolderView] = useState<"list" | "trace">("list");
  const [following, setFollowing] = useState(true);
  const [displayedFile, setDisplayedFile] = useState("");
  const [pendingRun, setPendingRun] = useState<LiveUpdate | null>(null);
  const [sessionNavigation, setSessionNavigation] = useState(() => createSessionNavigation(localSessionRoute(window.location.search)));
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const pickerMemory = useRef<SessionPickerMemory>({ filters: EMPTY_SESSION_FILTERS, scrollTop: 0 });
  const sessionOpenerRef = useRef<HTMLButtonElement>(null);
  const sessionNavigationRef = useRef(sessionNavigation);
  const traceRef = useRef(trace);
  const sessionSummaryRef = useRef(sessionSummary);
  sessionNavigationRef.current = sessionNavigation;
  traceRef.current = trace;
  sessionSummaryRef.current = sessionSummary;

  const localSessionEnabled = shouldPreferLocalSession(sessionNavigation.route);
  const sessionLoading = sessionNavigation.loading;
  const sessionError = sessionNavigation.error;

  const replaceSessionNavigation = useCallback((next: typeof sessionNavigation) => {
    sessionNavigationRef.current = next;
    setSessionNavigation(next);
  }, []);

  const closeSessionPicker = useCallback(() => {
    setSessionPickerOpen(false);
    window.requestAnimationFrame(() => sessionOpenerRef.current?.focus());
  }, []);

  const convo = useConversations(folderDir);
  const dashboard = useMemo(() => aggregateDashboard(convo.conversations, Date.now()), [convo.conversations]);
  const failedScan = useFailedScan(folderDir, convo.conversations);
  const live = folderDir !== null && folderView === "trace";
  const selectSearchEvent = useCallback((id: string, reveal = false) => {
    setSelectedId(id); setFollowing(false);
    if (reveal) { setActiveView("tree"); setMobileDetailOpen(true); }
  }, []);
  const { query, search, errors, matchIndex, matchCount, searchInputRef, onQueryChange, clearSearch, stepMatch, jumpNextError, jumpPreviousError, errorPosition, jumpSlowest } = useTraceSearch(trace, selectedId, selectSearchEvent);
  const overview = useMemo(() => sessionSummary ?? (trace ? browserSessionSummary(trace, label, rawSource) : null), [sessionSummary, trace, label, rawSource]);

  const annotationKey = sessionAnnotationKey(localSessionEnabled ? sessionSummary?.id ?? null : null, label);
  const ann = useAnnotations(annotationKey);
  const knownTags = useMemo(
    () =>
      [...new Set(Object.values(ann.annotations).map((a) => a.tag).filter((t): t is string => !!t))],
    [ann.annotations],
  );

  const onLoad = (t: ParsedTrace, lbl: string, source: string) => {
    closeExport(); setMobileDetailOpen(false);
    pickerMemory.current = { filters: EMPTY_SESSION_FILTERS, scrollTop: 0 };
    replaceSessionNavigation(clearSessionNavigation(sessionNavigationRef.current));
    setSessionSummary(null);
    setSessionList([]);
    setSessionPickerOpen(false);
    setTrace(t);
    setLabel(lbl);
    setRawSource(source);
    setSelectedId(t.roots[0]?.spanId ?? null);
    setActiveView("overview");
    setError(null);
    clearSearch();
  };

  const onLiveUpdate = useCallback(
    (u: LiveUpdate) => {
      setError(null);
      if (following) {
        setTrace(u.trace);
        setLabel(u.label);
        setRawSource(u.source);
        setDisplayedFile(u.label);
        setSelectedId(latestSpanId(u.trace.roots));
        setPendingRun(null);
      } else if (u.label === displayedFile) {
        setTrace(u.trace);
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
    closeExport(); setMobileDetailOpen(false);
    setTrace(null);
    setSelectedId(null);
    setFollowing(true);
    setPendingRun(null);
    setDisplayedFile("");
    clearSearch();
    setActiveView("overview");
  }, [clearSearch, closeExport]);

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
    setActiveView("tree");
    setFolderView("trace");
    liveWatch.followNewest(folderDir);
  }, [folderDir, liveWatch, resetTraceState]);

  const backToList = useCallback(() => {
    liveWatch.stop();
    setFolderView("list");
  }, [liveWatch]);

  const reset = () => {
    closeExport(); setMobileDetailOpen(false);
    pickerMemory.current = { filters: EMPTY_SESSION_FILTERS, scrollTop: 0 };
    replaceSessionNavigation(clearSessionNavigation(sessionNavigationRef.current));
    liveWatch.stop();
    setFolderDir(null);
    setFolderView("list");
    setTrace(null);
    setSelectedId(null);
    setError(null);
    setLabel("");
    setActiveView(DEFAULT_VIEW);
    clearSearch();
    setRawSource("");
    setFollowing(true);
    setPendingRun(null);
    setDisplayedFile("");
    setSessionSummary(null);
    setSessionList([]);
    setSessionPickerOpen(false);
    window.history.replaceState(null, "", sessionLocationForReset(window.location.pathname, window.location.search, window.location.hash));
  };

  useEffect(() => {
    const route = sessionNavigation.route;
    if (!route || !sessionNavigation.loading) return;

    const token = readViewerToken(window.location.hash);
    const sessionId = route.sessionId;
    const request = sessionNavigation.requestId;
    let cancelled = false;

    if (!token || !sessionId) {
      const failed = failSessionRequest(sessionNavigationRef.current, request, "This local session link is incomplete.");
      replaceSessionNavigation(failed);
      return () => { cancelled = true; };
    }

    const client = createViewerClient(token);
    void Promise.all([client.loadSession(sessionId, route.eventId ?? undefined), client.listSessions()])
      .then(([payload, sessions]) => {
        if (cancelled || !isCurrentSessionRequest(sessionNavigationRef.current, request, route)) return;
        const parsed = parseTraceText(payload.source);
        const selection = sessionEventSelection(payload.selectedEventId ?? route.eventId, parsed.byId, parsed.roots[0]?.spanId ?? null);
        const availableSessions = sessions.some((item) => item.id === payload.session.id)
          ? sessions
          : [payload.session, ...sessions];

        setTrace(parsed);
        setLabel(payload.session.title || "Local session");
        setRawSource(payload.source);
        setSessionSummary(payload.session);
        setSessionList(availableSessions);
        setSelectedId(selection.selectedId);
        setActiveView(selection.view);
        clearSearch();
        setMobileDetailOpen(selection.view === "tree");
        replaceSessionNavigation(completeSessionRequest(sessionNavigationRef.current, request, payload.session.id));
        closeSessionPicker();
      })
      .catch((loadError: unknown) => {
        if (cancelled || !isCurrentSessionRequest(sessionNavigationRef.current, request, route)) return;
        replaceSessionNavigation(failSessionRequest(
          sessionNavigationRef.current,
          request,
          loadError instanceof Error ? loadError.message : "TraceLens could not load this session.",
        ));
      });

    return () => { cancelled = true; };
  }, [closeSessionPicker, replaceSessionNavigation, sessionNavigation]);

  useEffect(() => {
    const onPopState = () => {
      const route = localSessionRoute(window.location.search);
      if (!route) {
        liveWatch.stop();
        setFolderDir(null);
        setFolderView("list");
        closeExport(); setMobileDetailOpen(false);
        setSessionPickerOpen(false);
        setError(null);
        setRawSource("");
        setShareRevision((revision) => revision + 1);
        replaceSessionNavigation(clearSessionNavigation(sessionNavigationRef.current));
        setSessionSummary(null);
        setSessionList([]);
        setTrace(null);
        setSelectedId(null);
        setActiveView(DEFAULT_VIEW);
        return;
      }

      const currentTrace = traceRef.current;
      if (sessionSummaryRef.current?.id === route.sessionId && currentTrace) {
        const selection = sessionEventSelection(route.eventId, currentTrace.byId, currentTrace.roots[0]?.spanId ?? null);
        replaceSessionNavigation(setLoadedSessionRoute(sessionNavigationRef.current, route));
        setSelectedId(selection.selectedId);
        setActiveView(selection.view);
        setMobileDetailOpen(selection.view === "tree");
        return;
      }

      replaceSessionNavigation(startSessionRequest(sessionNavigationRef.current, route));
    };
    const onHashChange = () => { if (!localSessionRoute(window.location.search)) onPopState(); };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [replaceSessionNavigation, liveWatch.stop]);

  // Open shared traces on initial load and same-document history/hash navigation.
  useEffect(() => {
    if (localSessionEnabled) return;
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
  }, [localSessionEnabled, shareRevision]);

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
      setMobileDetailOpen(true);
      if (live) setFollowing(false);
    },
    [live],
  );

  const onUserScroll = useCallback(() => {
    if (live && following) setFollowing(false);
  }, [live, following]);

  const onAnnotationSelect = useCallback(
    (id: string) => {
      clearSearch();
      setSelectedId(id);
      setActiveView("tree");
      setMobileDetailOpen(true);
      if (live) setFollowing(false);
    },
    [live, clearSearch],
  );

  const selectSession = useCallback((sessionId: string) => {
    closeExport(); setMobileDetailOpen(false);
    const route = { sessionId, eventId: null };
    const previous = sessionNavigationRef.current.route;
    if (previous?.sessionId !== sessionId || previous.eventId !== null) {
      window.history.pushState(null, "", sessionLocationForSelection(window.location.pathname, window.location.search, window.location.hash, sessionId));
    }
    replaceSessionNavigation(startSessionRequest(sessionNavigationRef.current, route));
  }, [replaceSessionNavigation]);

  const retrySession = useCallback(() => {
    const route = sessionNavigationRef.current.route;
    if (!route?.sessionId) return;
    replaceSessionNavigation(startSessionRequest(sessionNavigationRef.current, route));
  }, [replaceSessionNavigation]);

  const openOverviewEvent = useCallback((eventId: string) => {
    if (!trace?.byId.has(eventId)) return;
    clearSearch();
    const route = sessionNavigationRef.current.route;
    if (route?.sessionId) {
      const nextRoute = { ...route, eventId };
      window.history.pushState(null, "", sessionLocationForEvent(window.location.pathname, window.location.search, window.location.hash, eventId));
      replaceSessionNavigation(setLoadedSessionRoute(sessionNavigationRef.current, nextRoute));
    }
    setSelectedId(eventId);
    setActiveView("tree");
    setMobileDetailOpen(true);
    setFollowing(false);
  }, [replaceSessionNavigation, trace, clearSearch]);

  const selected = selectedId ? (trace?.byId.get(selectedId) ?? null) : null;
  const backToEvents = () => {
    setMobileDetailOpen(false);
    window.requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-span-id]")].find((element) => element.dataset.spanId === selectedId)?.focus());
  };
  const filtering = query.trim().length > 0;
  const currentMatchId =
    matchCount > 0 ? (search?.orderedMatchIds[matchIndex] ?? null) : null;

  return (
    <ThemeProvider>
      {folderDir && <div hidden={folderView !== "list"} className="h-full">
        <FolderBrowser
          folderName={folderDir.name}
          conversations={convo.conversations}
          loading={convo.loading}
          error={convo.error}
          dashboard={dashboard}
          failed={failedScan}
          onOpen={openConversation}
          onFollowNewest={followNewest}
          onClose={reset}
          selectedName={displayedFile}
        />
      </div>}
      {folderDir && folderView === "list" ? null : !trace ? (
        localSessionEnabled ? (
          <div className="flex h-full items-center justify-center bg-bg p-6">
            <div className="w-full max-w-sm border border-border bg-panel p-4">
              <div className="text-sm font-semibold text-text">{sessionLoading ? "Loading local session" : "Local session unavailable"}</div>
              {sessionError && <div role="alert" className="mt-2 text-sm text-error">{sessionError}</div>}
              {!sessionLoading && <div className="mt-4 flex gap-2">{sessionNavigation.route?.sessionId && <button type="button" onClick={retrySession} className="rounded border border-border px-3 py-1.5 text-[12px] text-muted hover:text-text">Retry</button>}<button type="button" onClick={reset} className="rounded border border-border px-3 py-1.5 text-[12px] text-muted hover:text-text">Open another trace</button></div>}
            </div>
          </div>
        ) : live ? (
          <LiveStandby
            state={liveWatch.state}
            folderName={liveWatch.folderName}
            onStop={backToList}
          />
        ) : (
          <Loader onLoad={onLoad} onError={setError} error={error} onStartLive={openFolder} />
        )
      ) : (
        <>
        <AppShell
          activeView={activeView}
          onSelectView={(view) => { setActiveView(view); setMobileDetailOpen(false); }}
          showOverview
          banner={sessionError || error ? <div role="alert" className="border-b border-border bg-panel-2 px-4 py-2 text-[12px] text-error">{sessionError || error}</div> : undefined}
          label={label}
          summary={trace.summary}
          onReset={reset}
          onOpenSessions={sessionSummary ? () => setSessionPickerOpen(true) : folderDir ? backToList : undefined}
          sessionsButtonRef={sessionOpenerRef}
          selectedEventId={selectedId}
          mobileDetailOpen={mobileDetailOpen}
          onBackToEvents={backToEvents}
          detail={activeView !== "overview" && activeView !== "diff" ? selected ? <SpanDetail node={selected} annotation={ann.annotations[selected.spanId]} onAnnotate={(a: Annotation) => ann.setAnnotation(selected, a)} knownTags={knownTags} /> : <div className="p-6 text-sm text-muted">Select a span to inspect it.</div> : undefined}
          exportActions={{ onReviewExport: reviewExport, canShare }}
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
            onJumpPreviousError: jumpPreviousError,
            errorPosition,
            onJumpSlowest: jumpSlowest,
            errorCount: errors.length,
            active: activeView === "tree",
          }}
        >
          {activeView === "overview" && overview && (
            <SessionOverview
              session={overview}
              onOpenEvent={openOverviewEvent}
            />
          )}
          {activeView !== "overview" && (
          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-panel">
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
                followId={selectedId}
                onUserScroll={onUserScroll}
                annotations={ann.annotations}
              />
            )}
            {activeView === "flamegraph" && (
              <FlamegraphView trace={trace} selectedId={selectedId} onSelect={onSpanSelect} />
            )}
            {activeView === "diff" && <DiffView trace={trace} label={label} />}
            {activeView === "annotations" && (
              <AnnotationsView annotations={ann.annotations} label={annotationKey} onSelect={onAnnotationSelect} />
            )}
            {live && !following && (
              <BackToLivePill newRun={pendingRun !== null} onClick={goLive} />
            )}
          </section>
          )}
        </AppShell>
        {sessionPickerOpen && sessionSummary && (
          <SessionPicker
            sessions={sessionList}
            activeId={sessionSummary.id}
            loading={sessionLoading}
            error={sessionError}
            onSelect={selectSession}
            onClose={closeSessionPicker}
            memory={pickerMemory}
          />
        )}
        </>
      )}
      {exportReview && <SharePreviewDialog key={exportReview.id} preview={exportReview.preview} intent={exportReview.intent} returnFocus={exportReview.returnFocus} onClose={closeExport} />}
    </ThemeProvider>
  );
}
