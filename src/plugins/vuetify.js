/* eslint-disable import/no-unresolved, dot-notation */
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import { en, zhHant, zhHans } from 'vuetify/locale';
import { useLocalStorage } from '@vueuse/core';

import KitwareMark from '@/src/components/icons/KitwareLogoIcon.vue';
import {
  DefaultTheme,
  DarkTheme,
  LightTheme,
  ThemeStorageKey,
} from '@/src/constants';

import { customThemes, breakpoints } from '../../tailwind.config';

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
          ...customThemes.nebula.colors,
          'selection-bg-color': '#01579b',
          'selection-border-color': '#01579b',
        },
        variables: customThemes.nebula.variables,
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
      sm: parseInt(breakpoints['sm'], 10),
      md: parseInt(breakpoints['md'], 10),
      lg: parseInt(breakpoints['lg'], 10),
      xl: parseInt(breakpoints['xl'], 10),
      xxl: parseInt(breakpoints['2xl'], 10),
    },
  },
  locale: {
    locale: 'en',
    fallback: 'en',
    messages: {
      en,
      zhHant,
      zhHans,
    },
  },
});

const theme = useLocalStorage(ThemeStorageKey, DefaultTheme);
if (theme.value !== DarkTheme && theme.value !== LightTheme) {
  theme.value = DefaultTheme;
}
vuetify.theme.global.name.value = theme.value;

export default vuetify;
