export interface LocalSessionRoute {
  sessionId: string | null;
  eventId: string | null;
}

export interface SessionNavigationState {
  route: LocalSessionRoute | null;
  activeSessionId: string | null;
  requestId: number;
  loading: boolean;
  error: string | null;
}

export function localSessionRoute(search: string): LocalSessionRoute | null {
  const params = new URLSearchParams(search);
  if (params.get("mode") !== "session") return null;
  return { sessionId: params.get("session"), eventId: params.get("event") };
}

export function shouldPreferLocalSession(route: LocalSessionRoute | null): boolean {
  return route !== null;
}

export function sessionAnnotationKey(sessionId: string | null, label: string): string {
  return sessionId ? `session:${sessionId}` : label;
}

function locationWith(pathname: string, params: URLSearchParams, hash: string): string {
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

export function sessionLocationForSelection(pathname: string, search: string, hash: string, sessionId: string): string {
  const params = new URLSearchParams(search);
  params.set("mode", "session");
  params.set("session", sessionId);
  params.delete("event");
  return locationWith(pathname, params, hash);
}

export function sessionLocationForEvent(pathname: string, search: string, hash: string, eventId: string): string {
  const params = new URLSearchParams(search);
  params.set("event", eventId);
  return locationWith(pathname, params, hash);
}

export function sessionLocationForReset(pathname: string, _search: string, _hash: string): string {
  return pathname;
}

export function createSessionNavigation(route: LocalSessionRoute | null): SessionNavigationState {
  return {
    route,
    activeSessionId: null,
    requestId: 1,
    loading: route !== null,
    error: null,
  };
}

export function startSessionRequest(state: SessionNavigationState, route: LocalSessionRoute): SessionNavigationState {
  return {
    ...state,
    route,
    requestId: state.requestId + 1,
    loading: true,
    error: null,
  };
}

export function setLoadedSessionRoute(state: SessionNavigationState, route: LocalSessionRoute): SessionNavigationState {
  return { ...state, route, loading: false, error: null };
}

export function clearSessionNavigation(state: SessionNavigationState): SessionNavigationState {
  return { ...state, route: null, activeSessionId: null, loading: false, error: null };
}

export function isCurrentSessionRequest(state: SessionNavigationState, requestId: number, route: LocalSessionRoute | null): boolean {
  return state.requestId === requestId && state.route?.sessionId === route?.sessionId && state.route?.eventId === route?.eventId;
}

export function completeSessionRequest(state: SessionNavigationState, requestId: number, activeSessionId: string): SessionNavigationState {
  if (state.requestId !== requestId) return state;
  return { ...state, activeSessionId, loading: false, error: null };
}

export function failSessionRequest(state: SessionNavigationState, requestId: number, error: string): SessionNavigationState {
  if (state.requestId !== requestId) return state;
  return { ...state, loading: false, error };
}

export function sessionEventSelection(
  eventId: string | null,
  eventIds: Pick<ReadonlySet<string>, "has">,
  fallbackId: string | null,
): { selectedId: string | null; view: "tree" | "overview" } {
  return eventId && eventIds.has(eventId)
    ? { selectedId: eventId, view: "tree" }
    : { selectedId: fallbackId, view: "overview" };
}
