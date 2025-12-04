// client/src/utils/time.js
// Convert UTC ISO string -> "YYYY-MM-DDTHH:MM" in local time
export function utcToLocalInputValue(utcString) {
  if (!utcString) return '';

  const d = new Date(utcString); // interpreted as UTC, but getters are local
  const pad = (n) => String(n).padStart(2, '0');

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1); // 0-based
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());

  return `${year}-${month}-${day}T${hours}:${mins}`;
}

// UTC ISO string -> human-readable local string
export function formatLocalDateTime(utcString) {
  if (!utcString) return '';
  const d = new Date(utcString);
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Normalizes MySQL DATETIME to proper UTC ISO
export function normalizeDbDatetime(value) {
  if (!value) return '';

  // MySQL DATETIME → treat as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(' ', 'T') + 'Z';  // append Z to mark UTC
  }

  // Already ISO? return as-is
  return value;
}
