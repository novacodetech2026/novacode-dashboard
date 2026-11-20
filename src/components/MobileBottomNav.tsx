import React from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Clock,
  MessageSquare,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  LifeBuoy,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

interface MobileNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
}

export const MobileBottomNav: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    canViewPlatformAdmin,
    canManageBusinessSettings,
    language,
    t,
  } = useApp();

  const items: MobileNavItem[] = [
    ...(canViewPlatformAdmin
      ? [
          {
            id: 'admin',
            label: t.nav.platformAdmin,
            icon: ShieldCheck,
            activeClass:
              'text-violet-600 dark:text-violet-400 bg-violet-50/70 dark:bg-violet-950/30',
          },
        ]
      : []),
    {
      id: 'overview',
      label: t.nav.overview,
      icon: LayoutDashboard,
      activeClass:
        'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/30',
    },
    {
      id: 'calendar',
      label: t.nav.calendar,
      icon: CalendarDays,
      activeClass:
        'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/30',
    },
    {
      id: 'appointments',
      label: t.nav.appointments,
      icon: Clock,
      activeClass:
        'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/30',
    },
    {
      id: 'messages',
      label: t.nav.messages,
      icon: MessageSquare,
      activeClass:
        'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/30',
    },
    canManageBusinessSettings
      ? {
          id: 'settings',
          label: language === 'es' ? 'Ajustes' : 'Settings',
          icon: SettingsIcon,
          activeClass:
            'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/30',
        }
      : {
          id: 'customers',
          label: t.nav.customers,
          icon: Users,
          activeClass:
            'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/30',
        },
    {
      id: 'support',
      label: language === 'es' ? 'Soporte' : 'Support',
      icon: LifeBuoy,
      activeClass:
        'text-indigo-600 dark:text-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/30',
    },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex items-center justify-around gap-0.5 px-1.5 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 shadow-lg"
    >
      {items.map(item => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            title={item.label}
            className={`flex-[1_1_0%] min-w-0 min-h-[44px] px-1 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1 font-semibold transition-colors ${
              isActive
                ? item.activeClass
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Icon className="w-[clamp(18px,5.5vw,22px)] h-[clamp(18px,5.5vw,22px)] shrink-0" />
            <span className="hidden min-[360px]:block w-full text-center text-[clamp(0.6rem,2.8vw,0.75rem)] leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
