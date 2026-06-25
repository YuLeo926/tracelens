import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunNode } from "../core/types";
import { toStored, isAnnotated, type Annotation, type StoredAnnotation } from "../core/annotations";
import { loadForLabel, saveForLabel } from "../lib/annotationStore";

export function useAnnotations(label: string) {
  const [annotations, setAnnotations] = useState<Record<string, StoredAnnotation>>({});

  useEffect(() => {
    setAnnotations(label ? loadForLabel(label) : {});
  }, [label]);

  const setAnnotation = useCallback(
    (node: RunNode, a: Annotation) => {
      setAnnotations((prev) => {
        const next = { ...prev };
        if (isAnnotated(a)) next[node.spanId] = toStored(a, node);
        else delete next[node.spanId];
        if (label) saveForLabel(label, next);
        return next;
      });
    },
    [label],
  );

  const annotatedIds = useMemo(() => new Set(Object.keys(annotations)), [annotations]);

  return { annotations, setAnnotation, annotatedIds };
}
