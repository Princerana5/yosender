/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens: dark defaults, overridden under `html.light`
        // via CSS variables (see index.css). All existing classes keep working
        // in both themes with zero per-file changes.
        ink: 'rgb(var(--c-ink) / <alpha-value>)', // app background
        panel: 'rgb(var(--c-panel) / <alpha-value>)', // cards / sidebar
        panel2: 'rgb(var(--c-panel2) / <alpha-value>)', // raised surfaces
        line: 'rgb(var(--c-line) / <alpha-value>)', // borders
        brand: '#10b981', // emerald primary (same both themes)
        branddim: '#065f46',
        accent: '#38bdf8', // sky for info/links
        warn: '#f59e0b',
        danger: '#ef4444',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
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
