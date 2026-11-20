export interface CurrencyOption {
  code: string;
  symbol: string;
  labelEn: string;
  labelEs: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'USD', symbol: '$', labelEn: 'USD ($) — US Dollar', labelEs: 'USD ($) — Dólar estadounidense' },
  { code: 'EUR', symbol: '€', labelEn: 'EUR (€) — Euro', labelEs: 'EUR (€) — Euro' },
  { code: 'MXN', symbol: 'MX$', labelEn: 'MXN (MX$) — Mexican Peso', labelEs: 'MXN (MX$) — Peso mexicano' },
  { code: 'DOP', symbol: 'RD$', labelEn: 'DOP (RD$) — Dominican Peso', labelEs: 'DOP (RD$) — Peso dominicano' },
  { code: 'CAD', symbol: 'CA$', labelEn: 'CAD (CA$) — Canadian Dollar', labelEs: 'CAD (CA$) — Dólar canadiense' },
  { code: 'GBP', symbol: '£', labelEn: 'GBP (£) — British Pound', labelEs: 'GBP (£) — Libra esterlina' },
  { code: 'COP', symbol: 'CO$', labelEn: 'COP (CO$) — Colombian Peso', labelEs: 'COP (CO$) — Peso colombiano' },
  { code: 'ARS', symbol: 'AR$', labelEn: 'ARS (AR$) — Argentine Peso', labelEs: 'ARS (AR$) — Peso argentino' },
  { code: 'CLP', symbol: 'CL$', labelEn: 'CLP (CL$) — Chilean Peso', labelEs: 'CLP (CL$) — Peso chileno' },
  { code: 'PEN', symbol: 'S/', labelEn: 'PEN (S/) — Peruvian Sol', labelEs: 'PEN (S/) — Sol peruano' },
  { code: 'BRL', symbol: 'R$', labelEn: 'BRL (R$) — Brazilian Real', labelEs: 'BRL (R$) — Real brasileño' },
];

export function normalizeCurrencyCode(code?: string | null, fallback = 'USD'): string {
  const cleaned = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (/^[A-Z]{3}$/.test(cleaned)) {
    return cleaned;
  }
  return fallback;
}

export function getCurrencySymbol(code?: string | null, fallbackSymbol = '$'): string {
  const normalized = normalizeCurrencyCode(code, '');
  if (!normalized) return fallbackSymbol;
  const match = SUPPORTED_CURRENCIES.find(c => c.code === normalized);
  return match ? match.symbol : normalized;
}
