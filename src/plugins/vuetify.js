import { createVuetify } from 'vuetify';
import { useLocalStorage } from '@vueuse/core';

import KitwareMark from '@/src/components/icons/KitwareLogoIcon.vue';
import {
  DefaultTheme,
  DarkTheme,
  LightTheme,
  ThemeStorageKey,
} from '@/src/constants';

const vuetify = createVuetify({
  defaults: {
    global: {
      ripple: false,
    },
    VBtn: {
      flat: true,
    },
  },
  icons: {
    values: {
      kitwareMark: {
        component: KitwareMark,
      },
    },
  },
  theme: {
    defaultTheme: DefaultTheme,
    themes: {
      [DarkTheme]: {
        dark: true,
        colors: {
          'selection-bg-color': '#01579b',
          'selection-border-color': '#01579b',
          surface: '#1e293b',
          'on-surface-variant': '#334155',
          background: '#0f172a',
          primary: '#0ea5e9',
          'primary-darken-1': '#0284c7',
          secondary: '#14b8a6',
          'secondary-darken-1': '#0d9488',
          success: '#22c55e',
          info: '#3b82f6',
          warning: '#eab308',
          error: '#ef4444',
          neutral: '#64748b',
          'neutral-darken-1': '#475569',
          'neutral-darken-2': '#334155',
          'neutral-darken-3': '#1e293b',
          'neutral-darken-4': '#0f172a',
          'neutral-darken-5': '#020617',
          'neutral-lighten-5': '#f8fafc',
          'neutral-lighten-4': '#f1f5f9',
          'neutral-lighten-3': '#e2e8f0',
          'neutral-lighten-2': '#cbd5e1',
          'neutral-lighten-1': '#94a3b8',
        },
      },
      [LightTheme]: {
        dark: false,
        colors: {
          'selection-bg-color': '#b3e5fc',
          'selection-border-color': '#b3e5fc',
          surface: '#f0f0f0',
          'on-surface-variant': '#d0d0d0',
        },
      },
    },
  },
  display: {
    mobileBreakpoint: 'md',
    thresholds: {
      xs: 600,
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      xxl: 1536,
    },
  },
});

const theme = useLocalStorage(ThemeStorageKey, DefaultTheme);
if (theme.value !== DarkTheme && theme.value !== LightTheme) {
  theme.value = DefaultTheme;
}
// vuetify.theme.global.name.value = theme.value;
vuetify.theme.change(theme.value);

export default vuetify;
