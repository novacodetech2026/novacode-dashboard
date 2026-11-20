import { Tenant } from '../types';

/**
 * Isolated Corporate Identity for Novacode Tech (Technology Company).
 * Completely independent from client business profiles, categories, hours, or logos.
 */
export const CORPORATE_BRAND = {
  companyName: 'Novacode Tech',
  taglineEn: 'Intelligent Business Automation',
  taglineEs: 'Automatización Inteligente de Negocios',
  descriptionEn:
    'Novacode Tech helps businesses streamline operations, automate customer interactions, and manage appointments through intelligent AI-powered solutions.',
  descriptionEs:
    'Novacode Tech ayuda a las empresas a optimizar operaciones, automatizar interacciones con clientes y gestionar citas mediante soluciones inteligentes con IA.',
  welcomeTitleEn: 'Welcome to Novacode Tech',
  welcomeTitleEs: 'Bienvenido a Novacode Tech',
  welcomeSubtitleEn: 'Your intelligent business automation platform.',
  welcomeSubtitleEs: 'Tu plataforma inteligente de automatización de negocios.',
  colors: {
    primary: '#4F46E5',
    secondary: '#6366F1',
    accent: '#8B5CF6',
    background: '#F8FAFC',
    text: '#0F172A',
  },
} as const;

/**
 * Neutral fallback shell when no client business is selected or loaded in Live Supabase mode.
 * Never spreads or inherits any client business (spa, salon, barber, etc.) profile data.
 */
export const CORPORATE_PLATFORM_SHELL: Tenant = {
  id: '',
  name: CORPORATE_BRAND.companyName,
  slug: 'novacode-tech',
  tagline: CORPORATE_BRAND.taglineEn,
  description: CORPORATE_BRAND.descriptionEn,
  isActive: true,
  category: 'custom_business',
  categoryLabelEn: CORPORATE_BRAND.taglineEn,
  categoryLabelEs: CORPORATE_BRAND.taglineEs,
  logo: '',
  timezone: 'UTC',
  defaultLanguage: 'en',
  currency: 'USD',
  currencySymbol: '$',
  phone: '',
  email: '',
  address: '',
  website: '',
  settings: {
    operatingHours: {
      0: { open: '09:00', close: '17:00', isClosed: false },
      1: { open: '09:00', close: '17:00', isClosed: false },
      2: { open: '09:00', close: '17:00', isClosed: false },
      3: { open: '09:00', close: '17:00', isClosed: false },
      4: { open: '09:00', close: '17:00', isClosed: false },
      5: { open: '09:00', close: '17:00', isClosed: false },
      6: { open: '09:00', close: '17:00', isClosed: false },
    },
    specialHours: [],
    cancellationBufferHours: 24,
    bufferBetweenAppointmentsMinutes: 15,
    aiAutomatedBooking: false,
    requireAtHomeAddress: false,
  },
};
