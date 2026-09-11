/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b1210',
        panel: '#101815',
        line: '#1e2b24',
        brand: '#16a34a',
        branddim: '#0d5c2e',
      },
    },
  },
  plugins: [],
};
