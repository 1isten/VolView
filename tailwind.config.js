/* eslint-disable import/no-extraneous-dependencies, dot-notation */
import colors from 'tailwindcss/colors';
import defaultTheme from 'tailwindcss/defaultTheme';

export const LightBlueDarken4 = '#01579b';
export const DefaultTheme = 'nebula';
export const customThemes = {
  [DefaultTheme]: {
    dark: true,
    colors: {
      'selection-bg-color': LightBlueDarken4,
      'selection-border-color': LightBlueDarken4,

      'blue': LightBlueDarken4,
      'blue-50': colors.sky[50],
      'blue-100': colors.sky[100],
      'blue-200': colors.sky[200],
      'blue-300': colors.sky[300],
      'blue-400': colors.sky[400],
      'blue-500': colors.sky[500],
      'blue-600': colors.sky[600],
      'blue-700': colors.sky[700],
      'blue-800': colors.sky[800],
      'blue-900': colors.sky[900],
      'blue-950': colors.sky[950],

      'gray-50': colors.slate[50],
      'gray-100': colors.slate[100],
      'gray-200': colors.slate[200],
      'gray-300': colors.slate[300],
      'gray-400': colors.slate[400],
      'gray-500': colors.slate[500],
      'gray-600': colors.slate[600],
      'gray-700': colors.slate[700],
      'gray-800': colors.slate[800],
      'gray-900': colors.slate[900],
      'gray-950': colors.slate[950],

      'dark-page': colors.slate[950],
      'background': colors.slate[900],
      'dark': colors.slate[800],
      'light': colors.gray[100],
      'surface-dark': colors.gray[900],
      'surface': colors.gray[800],
      'surface-light': colors.gray[700],
      'surface-bright': colors.slate[300],
      'surface-variant': colors.slate[400],

      'primary': colors.slate[500],
      'primary-darken-1': colors.gray[500],
      'secondary': colors.slate[600],
      'secondary-darken-1': colors.gray[600],
      'accent': colors.slate[700],

      'info': colors.blue[500],
      'alert': colors.cyan[500],
      'success': colors.teal[500],
      'positive': colors.green[500],
      'negative': colors.red[500],
      'warning': colors.yellow[500],
      'danger': colors.orange[500],
      'error': colors.red[600],
    },
    variables: {
      'border-color': colors.white,
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
      'theme-kbd': colors.blue[800],
      'theme-on-kbd': colors.blue[100],
      'theme-code': colors.gray[900],
      'theme-on-code': colors.blue[300],
    },
  },
};

export const breakpoints = {
  'sm': defaultTheme.screens['sm'],
  'md': defaultTheme.screens['md'],
  'lg': defaultTheme.screens['lg'],
  'xl': defaultTheme.screens['xl'],
  '2xl': defaultTheme.screens['2xl'],
};

/** @type {import('tailwindcss').Config} */
export default {
  important: '#app',
  corePlugins: {
    preflight: false,
    aspectRatio: false,
  },
  content: [
    // './index.html',
    './src/**/*.{html,vue,js,ts,jsx,tsx}',
  ],
  theme: {
    screens: {
      ...breakpoints,
    },
    extend: {
      colors: {
        ...customThemes.nebula.colors,
      },
      fontFamily: {
        sans: ['Roboto', ...defaultTheme.fontFamily.sans],
        mono: [...defaultTheme.fontFamily.mono],
      },
    },
  },
  plugins: [],
};
