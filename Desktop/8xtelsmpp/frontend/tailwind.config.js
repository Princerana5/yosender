/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 8xtelSMPP enterprise NOC theme — deep slate + emerald signal
        ink: '#0a0f14', // app background
        panel: '#101820', // cards / sidebar
        panel2: '#151f29', // raised surfaces
        line: '#1f2c38', // borders
        brand: '#10b981', // emerald primary
        branddim: '#065f46',
        accent: '#38bdf8', // sky for info/links
        warn: '#f59e0b',
        danger: '#ef4444',
        muted: '#8b98a5',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.25)',
        glow: '0 0 0 1px rgba(16,185,129,.35), 0 0 18px rgba(16,185,129,.15)',
      },
    },
  },
  plugins: [],
};
