/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Expose design tokens as Tailwind colours so JSX can use them
        bg:            'var(--bg)',
        'bg-subtle':   'var(--bg-subtle)',
        'bg-hover':    'var(--bg-hover)',
        border:        'var(--border)',
        'border-strong': 'var(--border-strong)',
        text:          'var(--text)',
        'text-muted':  'var(--text-muted)',
        'text-faint':  'var(--text-faint)',
        up:            'var(--up)',
        'up-bg':       'var(--up-bg)',
        down:          'var(--down)',
        'down-bg':     'var(--down-bg)',
        accent:        'var(--accent)',
        'accent-bg':   'var(--accent-bg)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        chip:    'var(--radius-chip)',
      },
    },
  },
  plugins: [],
}
