export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-faint">
        Coming in v1
      </span>
      <h2 className="text-lg text-text">{title}</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted">{blurb}</p>
    </div>
  );
}
