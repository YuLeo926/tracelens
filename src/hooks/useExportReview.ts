import { useCallback, useRef, useState } from "react";
import { shareSupported } from "../core/share";
import { prepareSharePreview, type SharePreview } from "../core/sharePreview";

export function useExportReview(source: string, onError: (message: string) => void) {
  const sequence = useRef(0);
  const [exportReview, setExportReview] = useState<{ id: number; preview: SharePreview; intent: "link" | "download"; returnFocus: HTMLElement | null } | null>(null);
  const closeExport = useCallback(() => setExportReview(null), []);
  const reviewExport = useCallback((intent: "link" | "download") => {
    if (!source) return;
    try { setExportReview({ id: ++sequence.current, preview: prepareSharePreview(source), intent, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null }); }
    catch { onError("Unable to prepare the export preview."); }
  }, [source, onError]);
  return { exportReview, closeExport, reviewExport, canShare: shareSupported() };
}
