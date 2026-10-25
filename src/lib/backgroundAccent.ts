import {
  hexToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsv,
} from "../tabs/settings/accentColor";

const SAMPLE_SIZE = 48;
const HUE_BINS = 24;
const MIN_TOTAL_WEIGHT = 2;

const cache = new Map<string, string | null>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("background image failed to load"));
    img.src = url;
  });
}

function dominantHex(data: Uint8ClampedArray): string | null {
  const weight = new Float64Array(HUE_BINS);
  const sinSum = new Float64Array(HUE_BINS);
  const cosSum = new Float64Array(HUE_BINS);
  const satSum = new Float64Array(HUE_BINS);
  const valSum = new Float64Array(HUE_BINS);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const { h, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (s < 12 || v < 15) continue;
    const w = (s / 100) * (v / 100);
    const bin = Math.min(HUE_BINS - 1, Math.floor((h / 360) * HUE_BINS));
    const rad = (h * Math.PI) / 180;
    weight[bin] += w;
    sinSum[bin] += Math.sin(rad) * w;
    cosSum[bin] += Math.cos(rad) * w;
    satSum[bin] += s * w;
    valSum[bin] += v * w;
  }

  let best = 0;
  let total = 0;
  for (let b = 0; b < HUE_BINS; b++) {
    total += weight[b];
    if (weight[b] > weight[best]) best = b;
  }
  if (total < MIN_TOTAL_WEIGHT || weight[best] <= 0) return null;

  const hue = ((Math.atan2(sinSum[best], cosSum[best]) * 180) / Math.PI + 360) % 360;
  const sat = Math.max(45, Math.min(85, satSum[best] / weight[best]));
  const val = Math.max(48, Math.min(78, valSum[best] / weight[best]));
  const rgb = hsvToRgb(hue, sat, val);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export async function extractBackgroundAccent(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url) ?? null;
  let result: string | null = null;
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const hex = dominantHex(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
      result = hex && hexToRgb(hex) ? hex : null;
    }
  } catch {
    result = null;
  }
  cache.set(url, result);
  return result;
}
