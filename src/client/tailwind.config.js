/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        neon: {
          green: '#39FF14',
          pink: '#FF006E',
          cyan: '#00F5FF',
          yellow: '#FFE600',
          purple: '#BF00FF',
        },
        street: {
          900: '#0A0A0A',
          800: '#111111',
          700: '#1A1A1A',
          600: '#222222',
          500: '#333333',
          400: '#666666',
          300: '#999999',
        },
      },
      fontFamily: {
        mono: ['"Space Mono"', '"JetBrains Mono"', 'monospace'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'glitch': 'glitch 0.3s ease-in-out infinite alternate',
        'scanline': 'scanline 8s linear infinite',
        'flicker': 'flicker 3s linear infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-neon': 'pulseNeon 2s ease-in-out infinite',
      },
      keyframes: {
        glitch: {
          '0%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        flicker: {
          '0%, 19.999%, 22%, 62.999%, 64%, 64.999%, 70%, 100%': { opacity: '1' },
          '20%, 21.999%, 63%, 63.999%, 65%, 69.999%': { opacity: '0.33' },
        },
        pulseNeon: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      boxShadow: {
        'neon-green': '0 0 5px #39FF14, 0 0 20px rgba(57, 255, 20, 0.3)',
        'neon-pink': '0 0 5px #FF006E, 0 0 20px rgba(255, 0, 110, 0.3)',
        'neon-cyan': '0 0 5px #00F5FF, 0 0 20px rgba(0, 245, 255, 0.3)',
        'neon-yellow': '0 0 5px #FFE600, 0 0 20px rgba(255, 230, 0, 0.3)',
        'neon-purple': '0 0 5px #BF00FF, 0 0 20px rgba(191, 0, 255, 0.3)',
      },
    },
  },
  plugins: [],
};
