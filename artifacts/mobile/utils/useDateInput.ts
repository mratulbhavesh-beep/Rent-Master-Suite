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
      return `${yyyy}-${mm}-${dd}`;
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
 * isoValue      → YYYY-MM-DD when input is complete and valid; "" when still typing or invalid
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
