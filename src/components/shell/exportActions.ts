import { encodeShare, shareUrl, type SharePayload } from "../../core/share";

/** The export actions the top-bar menu needs, provided by App. */
export interface ExportActions {
  onCopyLink: () => boolean | Promise<boolean>;
  onDownloadJson: () => void;
  canShare: boolean; // false on browsers without CompressionStream
}

interface CopyShareLinkOptions {
  rawSource: string;
  label: string;
  baseUrl: string;
  writeText: (text: string) => Promise<void>;
  encode?: (payload: SharePayload) => Promise<string>;
}

export async function copyShareLinkToClipboard({
  rawSource,
  label,
  baseUrl,
  writeText,
  encode = encodeShare,
}: CopyShareLinkOptions): Promise<boolean> {
  if (!rawSource) return false;
  try {
    const encoded = await encode({ name: label, source: rawSource });
    await writeText(shareUrl(baseUrl, encoded));
    return true;
  } catch {
    return false;
  }
}
