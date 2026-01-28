const EASTERN_TIMEZONE = "America/New_York";

const getTimeZoneOffset = (date: Date, timeZone = EASTERN_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.get("year"));
  const month = Number(lookup.get("month"));
  const day = Number(lookup.get("day"));
  const hour = Number(lookup.get("hour"));
  const minute = Number(lookup.get("minute"));
  const second = Number(lookup.get("second"));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
};

const buildEtBoundary = (dateStr: string, endOfDay: boolean) => {
  const [year, month, day] = dateStr.split("-").map((value) => Number(value));
  if (!year || !month || !day) {
    return null;
  }
  const utc = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
  );
  const offset = getTimeZoneOffset(utc, EASTERN_TIMEZONE);
  return utc.getTime() - offset;
};

export const getEtDayBounds = (dateStr: string) => {
  const start = buildEtBoundary(dateStr, false);
  const end = buildEtBoundary(dateStr, true);
  if (start === null || end === null) {
    return null;
  }
  return { start, end };
};

export const getEtDayStart = (dateStr: string) => buildEtBoundary(dateStr, false);

export const getEtDayEnd = (dateStr: string) => buildEtBoundary(dateStr, true);
