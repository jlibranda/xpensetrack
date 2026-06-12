/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'color-mix(in srgb, var(--brand-color, #1D9E75) 10%, white)',
          100: 'color-mix(in srgb, var(--brand-color, #1D9E75) 20%, white)',
          400: 'var(--brand-color, #1D9E75)',
          600: 'color-mix(in srgb, var(--brand-color, #1D9E75) 80%, black)',
        },
      },
    },
  },
  plugins: [],
};
