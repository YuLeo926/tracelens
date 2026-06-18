// Pure trace sharing: gzip + base64url encode/decode of a small payload, plus
// URL-hash helpers. Uses CompressionStream/Response (browsers + Node 18+).

export interface SharePayload {
  name: string; // the trace's label / filename
  source: string; // the original raw trace JSON text
}

export function shareSupported(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined"
  );
}

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipeThrough(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const buf = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const gz = await pipeThrough(bytes, new CompressionStream("gzip"));
  return bytesToBase64url(gz);
}

export async function decodeShare(encoded: string): Promise<SharePayload> {
  const gz = base64urlToBytes(encoded);
  const bytes = await pipeThrough(gz, new DecompressionStream("gzip"));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof obj?.name !== "string" || typeof obj?.source !== "string") {
    throw new Error("Invalid share payload");
  }
  return { name: obj.name, source: obj.source };
}

/** "#t=abc" | "#t=abc&x=1" -> "abc"; null when absent. */
export function readShareHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(h).get("t");
}

/** Build the shareable URL: `${base}#t=${encoded}` (base = origin + pathname). */
export function shareUrl(base: string, encoded: string): string {
  return `${base}#t=${encoded}`;
}
