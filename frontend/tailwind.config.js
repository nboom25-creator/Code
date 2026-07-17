/** @type {import('tailwindcss').Config} */

// PartForge AI — "engineering laboratory" theme.
// The standard palette names (slate/sky/emerald/amber/red/violet…) are remapped
// onto the lab design tokens so every component draws from one system.
// Canonical tokens live in src/index.css as CSS variables.

const graphite = {
  50: '#FAFCFF',
  100: '#F3F7FC', // text-primary
  200: '#E1E9F3',
  300: '#C6D3E2',
  400: '#A9B8CC', // text-secondary
  500: '#6F8199', // text-dim
  600: '#2B4059', // strong borders / hover surfaces
  700: '#1B2A42', // borders / raised controls
  800: '#101927', // elevated panels
  900: '#0B1220', // surface
  950: '#070B14', // page background
};

const cyan = {
  50: '#EDFCFF',
  100: '#DCF9FF',
  200: '#BFF3FF',
  300: '#8AE9FF',
  400: '#4FDDFF',
  500: '#23D5FF', // primary accent
  600: '#12A8D4',
  700: '#0E7FA3',
  800: '#0C5A75',
  900: '#0A3B4D',
  950: '#062430',
};

const violet = {
  50: '#F5F1FF',
  100: '#ECE3FF',
  200: '#DCCCFF',
  300: '#C0A6FF',
  400: '#A37FFF',
  500: '#8B5CFF', // secondary accent
  600: '#7442EA',
  700: '#5E31C4',
  800: '#472591',
  900: '#301A61',
  950: '#1D1140',
};

const emerald = {
  50: '#EDFDF6',
  100: '#D6FBEB',
  200: '#BFF9E2',
  300: '#8CF3CB',
  400: '#5CEDB5',
  500: '#32E6A1', // success
  600: '#21C486',
  700: '#189A69',
  800: '#12704D',
  900: '#0C4A34',
  950: '#052E20',
};

const amber = {
  50: '#FFF9EF',
  100: '#FFF2DD',
  200: '#FFE9C4',
  300: '#FFDA9E',
  400: '#FFCC7A',
  500: '#FFBE55', // warning
  600: '#EDA02C',
  700: '#C27D18',
  800: '#8F5A10',
  900: '#5E3B0B',
  950: '#33230A',
};

const coral = {
  50: '#FFF0F1',
  100: '#FFE0E3',
  200: '#FFC6CB',
  300: '#FFA3AB',
  400: '#FF808B',
  500: '#FF5F6D', // critical
  600: '#E84856',
  700: '#BF3541',
  800: '#8C262F',
  900: '#5C181E',
  950: '#330D11',
};

const blue = {
  50: '#F0F5FF',
  100: '#E0EBFF',
  200: '#C2D6FF',
  300: '#99BAFF',
  400: '#6F9DFF',
  500: '#5B8CFF',
  600: '#3F6CE0',
  700: '#2F51AD',
  800: '#233C7E',
  900: '#182A57',
  950: '#0E1A38',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: graphite,
        gray: graphite,
        zinc: graphite,
        sky: cyan,
        cyan,
        blue,
        violet,
        purple: violet,
        indigo: violet,
        emerald,
        green: emerald,
        amber,
        yellow: amber,
        orange: amber,
        red: coral,
        rose: coral,
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', '"Inter Variable"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 0 1px rgba(35,213,255,0.35), 0 0 18px -4px rgba(35,213,255,0.45)',
        'glow-cyan-soft': '0 0 14px -6px rgba(35,213,255,0.55)',
        'glow-violet': '0 0 0 1px rgba(139,92,255,0.35), 0 0 18px -4px rgba(139,92,255,0.4)',
        'panel': '0 1px 0 0 rgba(243,247,252,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        'hud': '0 2px 16px -6px rgba(0,0,0,0.7), 0 0 0 1px rgba(35,213,255,0.08)',
      },
      letterSpacing: {
        techy: '0.14em',
      },
      keyframes: {
        'led-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'sheen': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        },
      },
      animation: {
        'led-pulse': 'led-pulse 1.6s ease-in-out infinite',
        'sheen': 'sheen 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
