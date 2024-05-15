// eslint-disable-next-line import/no-extraneous-dependencies, import/no-import-module-exports
import defaultTheme from 'tailwindcss/defaultTheme';

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
    extend: {
      fontFamily: {
        sans: ['Roboto', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
