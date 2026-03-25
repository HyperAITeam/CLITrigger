/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        warm: {
          50: '#FEFDFB',
          100: '#FBF8F3',
          200: '#F5F0E8',
          300: '#E8E0D4',
          400: '#C4B89E',
          500: '#A09178',
          600: '#7D6E56',
          700: '#5A4F3D',
          800: '#3D3629',
          900: '#2A2419',
        },
        accent: {
          gold: '#D4A843',
          goldLight: '#E8C96A',
          goldDark: '#B08A2E',
          amber: '#F0B429',
        },
        status: {
          success: '#4CAF50',
          running: '#2196F3',
          error: '#E53935',
          warning: '#FF9800',
          info: '#607D8B',
          merged: '#9C27B0',
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
        'soft': '0 2px 8px rgba(0, 0, 0, 0.06)',
        'card': '0 4px 16px rgba(0, 0, 0, 0.08)',
        'elevated': '0 8px 32px rgba(0, 0, 0, 0.12)',
        'gold': '0 4px 16px rgba(212, 168, 67, 0.2)',
      },
    },
  },
  plugins: [],
};
