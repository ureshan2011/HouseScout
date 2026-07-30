// CSV export — a Pro feature, done in the browser with no dependency.

/** Serialise rows to RFC 4180 CSV. Keys of the first row become the header. */
export function toCsv(rows: Record<string, string | number>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    // Quote when the value contains a delimiter, quote or newline; double inner quotes.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\r\n");
}

/** Trigger a download of `csv` as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 correctly — NZ addresses contain macrons.
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
