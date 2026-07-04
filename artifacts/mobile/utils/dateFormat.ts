/**
 * Formats any date value as DD/MM/YYYY (e.g. 29/05/2026).
 * Handles ISO date strings (with or without time), Date objects, null, and undefined.
 */
export function fmtDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  const d =
    typeof dateStr === "string"
      ? new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00")
      : dateStr;
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
