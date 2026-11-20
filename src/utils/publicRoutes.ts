export type PublicComplianceRoute = 'sms-consent' | 'privacy-policy' | 'terms-of-service';

export const PUBLIC_ROUTE_PATHS: Record<PublicComplianceRoute, string> = {
  'sms-consent': '/sms-consent',
  'privacy-policy': '/privacy-policy',
  'terms-of-service': '/terms-of-service',
};

export function normalizePublicPathname(pathname: string): string {
  const cleaned = (pathname || '/').trim().replace(/\/+$/, '');
  return (cleaned || '/').toLowerCase();
}

export function resolvePublicRoute(pathname: string): PublicComplianceRoute | null {
  const normalized = normalizePublicPathname(pathname);
  if (normalized === '/sms-consent') return 'sms-consent';
  if (normalized === '/privacy-policy') return 'privacy-policy';
  if (normalized === '/terms-of-service') return 'terms-of-service';
  return null;
}

export function isPublicComplianceRoute(pathname: string): boolean {
  return resolvePublicRoute(pathname) !== null;
}

export interface PublicBusinessQueryParams {
  businessId?: string | null;
  slug?: string | null;
}

export function parsePublicBusinessQuery(search: string): PublicBusinessQueryParams {
  try {
    const params = new URLSearchParams(search || '');
    const rawId =
      params.get('business_id') ||
      params.get('businessId') ||
      params.get('business') ||
      params.get('tenant_id') ||
      '';
    const rawSlug = params.get('slug') || '';
    return {
      businessId: rawId.trim() || null,
      slug: rawSlug.trim().toLowerCase() || null,
    };
  } catch {
    return { businessId: null, slug: null };
  }
}

export function buildPublicRouteHref(
  route: PublicComplianceRoute,
  options?: { businessId?: string | null; slug?: string | null }
): string {
  const basePath = PUBLIC_ROUTE_PATHS[route];
  const params = new URLSearchParams();
  if (options?.businessId) {
    params.set('business_id', options.businessId);
  } else if (options?.slug) {
    params.set('slug', options.slug);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
