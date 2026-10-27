export type DiffLine =
  | { kind: "same"; text: string; oldNo: number; newNo: number }
  | { kind: "added"; text: string; newNo: number }
  | { kind: "removed"; text: string; oldNo: number };

const MAX_EDIT_DISTANCE = 4000;

export function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  const max = n + m;
  const offset = max + 1;
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 3);
  let found = max === 0;

  for (let d = 0; d <= max && !found; d++) {
    if (d > MAX_EDIT_DISTANCE) return null;
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    trace.push(next);
    v = next;
  }

  const middle: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const prev = d > 0 ? trace[d - 1] : new Int32Array(2 * max + 3);
    const k = x - y;
    const down = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = d > 0 ? prev[offset + prevK] : 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      middle.push({ kind: "same", text: a[start + x], oldNo: start + x + 1, newNo: start + y + 1 });
    }
    if (d === 0) break;
    if (down) {
      y--;
      middle.push({ kind: "added", text: b[start + y], newNo: start + y + 1 });
    } else {
      x--;
      middle.push({ kind: "removed", text: a[start + x], oldNo: start + x + 1 });
    }
  }
  middle.reverse();

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: a[i], oldNo: i + 1, newNo: i + 1 });
  out.push(...middle);
  for (let i = 0; i < a.length - endA; i++) {
    out.push({ kind: "same", text: a[endA + i], oldNo: endA + i + 1, newNo: endB + i + 1 });
  }
  return out;
}

export type DiffHunkLine = DiffLine | { kind: "gap"; hidden: number };

export function foldDiff(lines: DiffLine[], context = 3): DiffHunkLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true;
  });
  const out: DiffHunkLine[] = [];
  let hidden = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (hidden) out.push({ kind: "gap", hidden });
      hidden = 0;
      out.push(l);
    } else {
      hidden++;
    }
  });
  if (hidden) out.push({ kind: "gap", hidden });
  return out;
}
