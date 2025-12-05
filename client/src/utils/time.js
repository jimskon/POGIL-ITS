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

// Normalizes MySQL DATETIME to a JS-friendly local datetime
export function normalizeDbDatetime(value) {
  if (!value) return '';

  // MySQL DATETIME → treat as LOCAL time (NOT UTC)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return value.replace(' ', 'T');  // NO 'Z'
  }

  return value;
}


// Input:  "2025-12-04 02:59:00"  (UTC)
// Output: "2025-12-03 9:59PM"    (local time)
export function formatUtcToLocal(utcString) {
  if (!utcString) return '';

  // Match "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS"
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(utcString);
  if (!m) return '';

  const [, year, month, day, hour, minute, second = '0'] = m.map(Number);

  // Treat parsed values as UTC
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (isNaN(d.getTime())) return '';

  const pad2 = (n) => String(n).padStart(2, '0');

  const localYear = d.getFullYear();
  const localMonth = pad2(d.getMonth() + 1);
  const localDay = pad2(d.getDate());

  let localHour = d.getHours();
  const localMinute = pad2(d.getMinutes());
  const ampm = localHour >= 12 ? 'PM' : 'AM';

  localHour = localHour % 12;
  if (localHour === 0) localHour = 12; // 0 → 12AM / 12PM

  return `${localYear}-${localMonth}-${localDay} ${localHour}:${localMinute}${ampm}`;
}

// Input:  "2025-12-04 02:59:00" or "2025-12-04T02:59:00"
// Output: Date object (local representation, but constructed from UTC fields)
// Convert MySQL DATETIME (UTC) or ISO to a Date object (UTC)
export function parseUtcDbDatetime(value) {
  if (!value) return null;

  // MySQL DATETIME: "YYYY-MM-DD HH:MM:SS" -> treat as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    const iso = value.replace(' ', 'T') + 'Z'; // mark as UTC
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Already ISO or something Date can parse
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
