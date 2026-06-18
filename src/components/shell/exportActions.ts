/** The export actions the top-bar menu needs, provided by App. */
export interface ExportActions {
  onCopyLink: () => void | Promise<void>;
  onDownloadJson: () => void;
  canShare: boolean; // false on browsers without CompressionStream
}
