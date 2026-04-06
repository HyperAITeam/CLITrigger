/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        warm: {
          50: 'var(--color-bg-secondary)',
          100: 'var(--color-bg-primary)',
          200: 'var(--color-bg-tertiary)',
          300: 'var(--color-border-strong)',
          400: 'var(--color-text-faint)',
          500: 'var(--color-text-muted)',
          600: 'var(--color-text-tertiary)',
          700: 'var(--color-text-secondary)',
          800: 'var(--color-text-primary)',
          900: 'var(--color-selection-text)',
        },
        accent: {
          gold: 'var(--color-accent)',
          goldLight: 'var(--color-accent-light)',
          goldDark: 'var(--color-accent-dark)',
          amber: 'var(--color-accent-amber)',
        },
        status: {
          success: '#4CAF50',
          running: '#2196F3',
          error: '#E53935',
          warning: '#FF9800',
          info: '#607D8B',
          merged: '#9C27B0',
        },
        theme: {
          bg: 'var(--color-bg-primary)',
          'bg-secondary': 'var(--color-bg-secondary)',
          'bg-tertiary': 'var(--color-bg-tertiary)',
          card: 'var(--color-bg-card)',
          input: 'var(--color-bg-input)',
          hover: 'var(--color-bg-hover)',
          active: 'var(--color-bg-active)',
          text: 'var(--color-text-primary)',
          'text-secondary': 'var(--color-text-secondary)',
          'text-tertiary': 'var(--color-text-tertiary)',
          muted: 'var(--color-text-muted)',
          faint: 'var(--color-text-faint)',
          border: 'var(--color-border)',
          'border-strong': 'var(--color-border-strong)',
          accent: 'var(--color-accent)',
          'accent-light': 'var(--color-accent-light)',
          'accent-dark': 'var(--color-accent-dark)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      borderRadius: {
        'pill': '9999px',
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      boxShadow: {
        'soft': 'var(--shadow-soft)',
        'card': 'var(--shadow-card)',
        'elevated': 'var(--shadow-elevated)',
        'gold': 'var(--shadow-gold)',
      },
    },
  },
  plugins: [],
};
