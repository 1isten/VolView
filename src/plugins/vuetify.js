// eslint-disable-next-line import/no-unresolved
import 'vuetify/styles';
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
      rounded: false,
    },
    VBtn: {
      flat: true,
      rounded: 'xs',
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

          'gray-50': '#f9fafb',
          'gray-100': '#f3f4f6',
          'gray-200': '#e5e7eb',
          'gray-300': '#d1d5db',
          'gray-400': '#9ca3af',
          'gray-500': '#6b7280',
          'gray-600': '#4b5563',
          'gray-700': '#374151',
          'gray-800': '#1f2937',
          'gray-900': '#111827',
          'gray-950': '#030712',

        // Nebula START
          'dark-page': '#111827', // gray-900
          background: '#0f172a', // slate-900
          // 'background-overlay-multiplier': 1,
          dark: '#1f2937', // gray-800
          surface: '#1e293b', // slate-800
          // 'surface-overlay-multiplier': 1,
          'surface-light': '#334155', // slate-700
          // 'surface-light-overlay-multiplier': 1,
          'surface-bright': '#d1d5db', // gray-300
          // 'surface-bright-overlay-multiplier': 2,
          'surface-variant': '#9ca3af', // gray-400
          // 'surface-variant-overlay-multiplier': 1,

          primary: '#6b7280', // gray-500
          // 'primary-overlay-multiplier': 1,
          // 'primary-darken-1': '#1c2d60',
          // 'primary-darken-1-overlay-multiplier': 1,
          secondary: '#4b5563', // gray-600
          // 'secondary-overlay-multiplier': 2,
          // 'secondary-darken-1': '#0369a1', // sky-700
          // 'secondary-darken-1-overlay-multiplier': 1,
          accent: '#374151', // gray-700
          // 'accent-overlay-multiplier': 2,
          info: '#3b82f6', // blue-500
          // 'info-overlay-multiplier': 1,
          positive: '#14b8a6', // teal-500
          success: '#22c55e', // green-500
          // 'success-overlay-multiplier': 2,
          negative: '#ef4444', // red-500
          error: '#ef4444', // red-500
          // 'error-overlay-multiplier': 2,
          warning: '#eab308', // yellow-500
          // 'warning-overlay-multiplier': 2,

          // 'on-background': '#ffffff',
          // 'on-surface': '#ffffff',
          // 'on-surface-bright': '#ffffff',
          // 'on-surface-light': '#ffffff',
          // 'on-surface-variant': '#ffffff',
          // 'on-primary': '#ffffff',
          // 'on-primary-darken-1': '#ffffff',
          // 'on-secondary': '#ffffff',
          // 'on-secondary-darken-1': '#ffffff',
          // 'on-accent': '#ffffff',
          // 'on-info': '#ffffff',
          // 'on-success': '#ffffff',
          // 'on-error': '#ffffff',
          // 'on-warning': '#ffffff',
        },
        variables: {
          'border-color': '#ffffff',
          'border-opacity': 0.2,
          'high-emphasis-opacity': 0.87,
          'medium-emphasis-opacity': 0.6,
          'disabled-opacity': 0.38,
          'idle-opacity': 0.04,
          'hover-opacity': 0.04,
          'focus-opacity': 0.12,
          'selected-opacity': 0.12,
          'activated-opacity': 0.12,
          'pressed-opacity': 0.16,
          'dragged-opacity': 0.08,
          'theme-kbd': '#1e40af',
          'theme-on-kbd': '#dbeafe',
          'theme-code': '#0f172a',
          'theme-on-code': '#93c5fd',
        },
        // Nebula END
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
    mobileBreakpoint: 'lg',
    thresholds: {
      xs: 0,
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
vuetify.theme.global.name.value = theme.value;

export default vuetify;
