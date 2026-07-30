/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral slate base so the semantic colours below carry the meaning.
        ink: {
          950: '#080b12',
          900: '#0d111a',
          850: '#131824',
          800: '#1a2030',
          700: '#252d40',
          600: '#354057',
          500: '#4a5670',
          400: '#6b7794',
          300: '#94a0bd',
          200: '#c2cbe0',
          100: '#e4e9f4',
        },
        gain: '#12a67a',
        loss: '#e0524a',
        warn: '#d99a2b',
        info: '#3d82d1',
        // Reserved exclusively for live-money and irreversible actions.
        danger: '#c02a2a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
