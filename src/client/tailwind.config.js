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
          DEFAULT: 'var(--color-accent)',
          light: 'var(--color-accent-light)',
          dark: 'var(--color-accent-dark)',
          amber: 'var(--color-accent-amber)',
        },
        status: {
          success: '#34C759',
          running: '#007AFF',
          error: '#FF3B30',
          warning: '#FF9500',
          info: '#8E8E93',
          merged: '#AF52DE',
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
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in-right': 'slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'pulse-soft': 'pulseSoft 2s infinite',
        'shimmer': 'shimmer 2s infinite linear',
        'aurora-glow': 'auroraGlow 3s infinite ease-in-out',
      },
      keyframes: {
        auroraGlow: {
          '0%, 100%': { 
            boxShadow: '0 0 10px rgba(0, 122, 255, 0.4), 0 0 20px rgba(0, 122, 255, 0.2), 0 0 30px rgba(0, 122, 255, 0.1)',
            opacity: '1'
          },
          '50%': { 
            boxShadow: '0 0 20px rgba(0, 122, 255, 0.6), 0 0 40px rgba(0, 122, 255, 0.3), 0 0 60px rgba(0, 122, 255, 0.15)',
            opacity: '0.8'
          },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'DEFAULT': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        'soft': 'var(--shadow-soft)',
        'card': 'var(--shadow-card)',
        'elevated': 'var(--shadow-elevated)',
        'accent': 'var(--shadow-accent)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
      },
    },
  },
  plugins: [],
};
