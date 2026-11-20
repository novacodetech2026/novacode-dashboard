export type TimezoneRegion =
  | 'Americas'
  | 'Europe'
  | 'Asia'
  | 'Pacific'
  | 'Africa'
  | 'Other';

export interface TimezoneEntry {
  id: string;
  city: string;
  region: TimezoneRegion;
  regionLabel: string;
  offsetLabel: string;
  offsetMinutes: number;
  searchKeywords: string;
}

const CURATED_TIMEZONES: string[] = [
  // Americas
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Montreal',
  'America/Mexico_City',
  'America/Monterrey',
  'America/Cancun',
  'America/Tijuana',
  'America/Santo_Domingo',
  'America/Puerto_Rico',
  'America/Havana',
  'America/Guatemala',
  'America/Costa_Rica',
  'America/Panama',
  'America/Bogota',
  'America/Lima',
  'America/Guayaquil',
  'America/Caracas',
  'America/La_Paz',
  'America/Santiago',
  'America/Asuncion',
  'America/Montevideo',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  // Europe
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Rome',
  'Europe/Vienna',
  'Europe/Prague',
  'Europe/Warsaw',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Istanbul',
  // Asia
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Manila',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Seoul',
  'Asia/Tokyo',
  // Pacific & Australia
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'Pacific/Fiji',
  // Africa
  'Africa/Casablanca',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  // Global
  'UTC',
];

const EXTRA_KEYWORDS: Record<string, string> = {
  'America/New_York': 'united states usa east coast est edt miami boston washington atlanta',
  'America/Chicago': 'united states usa central cst cdt dallas houston austin',
  'America/Denver': 'united states usa mountain mst mdt',
  'America/Los_Angeles': 'united states usa pacific pst pdt california san francisco seattle',
  'America/Santo_Domingo': 'dominican republic republica dominicana rd',
  'America/Puerto_Rico': 'san juan pr',
  'America/Mexico_City': 'mexico cdmx df guadalajara',
  'America/Bogota': 'colombia medellin cali',
  'America/Lima': 'peru',
  'America/Santiago': 'chile',
  'America/Argentina/Buenos_Aires': 'argentina',
  'America/Sao_Paulo': 'brazil brasil rio',
  'America/Toronto': 'canada ontario',
  'Europe/Madrid': 'spain españa barcelona',
  'Europe/London': 'uk united kingdom england britain gmt bst',
  'Europe/Paris': 'france francia',
  'Europe/Berlin': 'germany alemania',
  'Europe/Rome': 'italy italia milan',
  'Asia/Tokyo': 'japan japon',
  'Asia/Dubai': 'uae emirates',
  'Asia/Kolkata': 'india mumbai delhi bangalore ist',
  'Australia/Sydney': 'australia aedt aest',
};

function parseRegion(tzId: string): { region: TimezoneRegion; regionLabel: string } {
  if (tzId === 'UTC' || tzId.startsWith('Etc/')) {
    return { region: 'Other', regionLabel: 'UTC / Global' };
  }
  const prefix = tzId.split('/')[0];
  if (prefix === 'America') return { region: 'Americas', regionLabel: 'Americas' };
  if (prefix === 'Europe') return { region: 'Europe', regionLabel: 'Europe' };
  if (prefix === 'Asia') return { region: 'Asia', regionLabel: 'Asia' };
  if (prefix === 'Australia' || prefix === 'Pacific') return { region: 'Pacific', regionLabel: 'Australia & Pacific' };
  if (prefix === 'Africa') return { region: 'Africa', regionLabel: 'Africa' };
  return { region: 'Other', regionLabel: 'Other Regions' };
}

function formatCityName(tzId: string): string {
  if (tzId === 'UTC') return 'UTC (Coordinated Universal Time)';
  const parts = tzId.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

function getDynamicUtcOffset(tzId: string, now: Date): { offsetLabel: string; offsetMinutes: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzId,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    if (tzPart === 'GMT' || tzPart === 'UTC') {
      return { offsetLabel: 'UTC+00:00', offsetMinutes: 0 };
    }
    const normalized = tzPart.replace('GMT', 'UTC').replace('-', '−');
    const match = tzPart.match(/([+-])(\d{1,2}):?(\d{2})?/);
    let offsetMinutes = 0;
    if (match) {
      const sign = match[1] === '-' ? -1 : 1;
      const hrs = parseInt(match[2], 10) || 0;
      const mins = parseInt(match[3] || '0', 10) || 0;
      offsetMinutes = sign * (hrs * 60 + mins);
    }
    return { offsetLabel: normalized, offsetMinutes };
  } catch {
    return { offsetLabel: 'UTC+00:00', offsetMinutes: 0 };
  }
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export function getAllSupportedTimezones(): string[] {
  const intlWithSupported = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const supported =
    typeof intlWithSupported.supportedValuesOf === 'function'
      ? intlWithSupported.supportedValuesOf('timeZone')
      : [];

  const merged = new Set<string>([...CURATED_TIMEZONES, ...supported]);
  return Array.from(merged).filter(tz => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  });
}

let cachedEntries: TimezoneEntry[] | null = null;
let cachedTimestamp = 0;

export function getTimezoneEntries(): TimezoneEntry[] {
  const nowMs = Date.now();
  // Refresh offset cache every 15 minutes so DST transitions stay accurate
  if (cachedEntries && nowMs - cachedTimestamp < 15 * 60 * 1000) {
    return cachedEntries;
  }

  const now = new Date(nowMs);
  const ids = getAllSupportedTimezones();
  const entries: TimezoneEntry[] = ids.map(id => {
    const city = formatCityName(id);
    const { region, regionLabel } = parseRegion(id);
    const { offsetLabel, offsetMinutes } = getDynamicUtcOffset(id, now);
    const extra = EXTRA_KEYWORDS[id] || '';
    const searchKeywords = `${id} ${city} ${regionLabel} ${offsetLabel} ${extra}`.toLowerCase();

    return {
      id,
      city,
      region,
      regionLabel,
      offsetLabel,
      offsetMinutes,
      searchKeywords,
    };
  });

  // Sort by region priority then city name
  const regionOrder: Record<TimezoneRegion, number> = {
    Americas: 1,
    Europe: 2,
    Asia: 3,
    Pacific: 4,
    Africa: 5,
    Other: 6,
  };

  entries.sort((a, b) => {
    const rDiff = regionOrder[a.region] - regionOrder[b.region];
    if (rDiff !== 0) return rDiff;
    return a.city.localeCompare(b.city);
  });

  cachedEntries = entries;
  cachedTimestamp = nowMs;
  return entries;
}

export function isValidIanaTimezone(tzId?: string | null): boolean {
  const cleaned = typeof tzId === 'string' ? tzId.trim() : '';
  if (!cleaned) return false;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: cleaned }).resolvedOptions().timeZone;
    return Boolean(resolved);
  } catch {
    return false;
  }
}

export function formatTimezoneSummary(tzId?: string): string {
  if (!tzId) return 'UTC+00:00';
  const entry = getTimezoneEntries().find(t => t.id === tzId);
  if (entry) {
    return `${entry.city} — ${entry.offsetLabel}`;
  }
  const { offsetLabel } = getDynamicUtcOffset(tzId, new Date());
  return `${formatCityName(tzId)} — ${offsetLabel}`;
}
