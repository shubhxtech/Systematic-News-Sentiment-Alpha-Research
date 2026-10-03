/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      animation: {
        'flash-green': 'flashGreen 0.6s ease-out',
        'flash-red':   'flashRed 0.6s ease-out',
        'spin-slow':   'spin 2s linear infinite',
        'pulse-fast':  'pulse 1s ease-in-out infinite',
      },
      keyframes: {
        flashGreen: { '0%': { backgroundColor: 'rgba(16,185,129,0.35)' }, '100%': { backgroundColor: 'transparent' } },
        flashRed:   { '0%': { backgroundColor: 'rgba(239,68,68,0.35)' },  '100%': { backgroundColor: 'transparent' } },
      },
    },
  },
  plugins: [],
}
