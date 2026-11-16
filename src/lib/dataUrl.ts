export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = comma < 0 ? "" : dataUrl.slice(0, comma);
  if (!header.startsWith("data:") || !header.endsWith(";base64")) {
    throw new Error("Unsupported data URL");
  }
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: header.slice("data:".length, -";base64".length) });
}
