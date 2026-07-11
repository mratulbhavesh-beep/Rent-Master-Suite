import { useState } from "react";

function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const clean = iso.split("T")[0];
  const parts = clean.split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[0]}`;
  }
  return "";
}

/**
 * Returns true only when `iso` (YYYY-MM-DD) is a real calendar date.
 * Checks actual days-in-month including leap years.
 * Does NOT accept empty strings or partially valid dates.
 */
export function isValidCalendarDate(iso: string): boolean {
  if (!iso) return false;
  const parts = iso.split("-");
  if (parts.length !== 3 || parts[0].length !== 4) return false;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2100) return false;
  // new Date(y, m, 0) = last day of month m in year y (day-0 trick)
  const daysInMonth = new Date(y, m, 0).getDate();
  return d <= daysInMonth;
}

function displayToIso(display: string): string {
  const digits = display.replace(/\D/g, "");
  if (digits.length === 8) {
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    const d = parseInt(dd, 10);
    const m = parseInt(mm, 10);
    const y = parseInt(yyyy, 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2100) {
      // Real calendar check: reject e.g. 31/02 or 29/02 on non-leap years
      const daysInMonth = new Date(y, m, 0).getDate();
      if (d <= daysInMonth) {
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  }
  return "";
}

function autoFormat(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length > 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  } else if (digits.length > 2) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return digits;
}

/**
 * Dedicated hook for DD/MM/YYYY text input fields.
 *
 * displayValue  → bind to <TextInput value={...}>
 * onChangeDisplay → bind to <TextInput onChangeText={...}>; auto-inserts "/" at positions 2 and 5
 * isoValue      → YYYY-MM-DD when input is complete and calendar-valid; "" otherwise
 * setFromIso    → call when loading a date from API/state (e.g. in useEffect after fetch)
 *
 * Internal/backend data format (YYYY-MM-DD) is unchanged.
 * Only the TextInput display is affected.
 */
export function useDateInput(isoInitial: string) {
  const [displayValue, setDisplayValue] = useState(() => isoToDisplay(isoInitial));

  const onChangeDisplay = (raw: string) => {
    setDisplayValue(autoFormat(raw));
  };

  const setFromIso = (iso: string) => {
    setDisplayValue(isoToDisplay(iso));
  };

  const isoValue = displayToIso(displayValue);

  return { displayValue, onChangeDisplay, isoValue, setFromIso };
}
