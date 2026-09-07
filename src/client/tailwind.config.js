/** @type {import('tailwindcss').Config} */

/**
 * Wrap a CSS custom property so Tailwind's opacity modifier works on it.
 * A plain 'var(--x)' color silently drops `/50` — Tailwind emits no rule at
 * all, so the class is a no-op. color-mix keeps the variable indirection
 * (themes still swap at runtime) while honouring the modifier.
 */
const themeVar = (name) => ({ opacityValue }) => {
  // No modifier, or the legacy bg-opacity-* variable form: use the raw value.
  if (opacityValue === undefined || String(opacityValue).startsWith('var(')) {
    return `var(${name})`;
  }
  return `color-mix(in srgb, var(${name}) ${Number(opacityValue) * 100}%, transparent)`;
};
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        warm: {
          0: themeVar('--color-bg-card'),
          50: themeVar('--color-bg-secondary'),
          100: themeVar('--color-bg-primary'),
          200: themeVar('--color-bg-tertiary'),
          300: themeVar('--color-border-strong'),
          400: themeVar('--color-text-faint'),
          500: themeVar('--color-text-muted'),
          600: themeVar('--color-text-tertiary'),
          700: themeVar('--color-text-secondary'),
          800: themeVar('--color-text-primary'),
          900: themeVar('--color-selection-text'),
        },
        accent: {
          DEFAULT: themeVar('--color-accent'),
          light: themeVar('--color-accent-light'),
          dark: themeVar('--color-accent-dark'),
          amber: themeVar('--color-accent-amber'),
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
          bg: themeVar('--color-bg-primary'),
          'bg-secondary': themeVar('--color-bg-secondary'),
          'bg-tertiary': themeVar('--color-bg-tertiary'),
          card: themeVar('--color-bg-card'),
          input: themeVar('--color-bg-input'),
          hover: themeVar('--color-bg-hover'),
          active: themeVar('--color-bg-active'),
          text: themeVar('--color-text-primary'),
          'text-secondary': themeVar('--color-text-secondary'),
          'text-tertiary': themeVar('--color-text-tertiary'),
          muted: themeVar('--color-text-muted'),
          faint: themeVar('--color-text-faint'),
          border: themeVar('--color-border'),
          'border-strong': themeVar('--color-border-strong'),
          accent: themeVar('--color-accent'),
          'accent-light': themeVar('--color-accent-light'),
          'accent-dark': themeVar('--color-accent-dark'),
        },
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Cascadia Code"', '"Cascadia Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'D2Coding', 'monospace'],
      },
      borderRadius: {
        'pill': '9999px',
        '2xl': '1rem',
      },
      animation: {
        'slide-down': 'slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in-right': 'slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        'pulse-soft': 'pulseSoft 2s infinite',
      },
      keyframes: {
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      zIndex: {
        overlay: '30',
        dropdown: '50',
        sticky: '60',
        modal: '100',
        floating: '110',
        toast: '150',
        tooltip: '200',
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
      },
    },
  },
  plugins: [],
};
