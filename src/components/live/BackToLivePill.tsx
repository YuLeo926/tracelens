interface Props {
  newRun: boolean;
  onClick: () => void;
}

export function BackToLivePill({ newRun, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-accent bg-panel px-4 py-1.5 text-[12px] text-text shadow-lg hover:bg-elev"
    >
      ↓ {newRun ? "New run, go live" : "Back to live"}
    </button>
  );
}
