/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mist: {
          50: '#f7f8f9',
          100: '#eef0f2',
          200: '#dfe3e7',
          300: '#c7ccd2',
          400: '#9aa1a9',
          500: '#747d86',
          600: '#5a636c',
          700: '#454d55',
          800: '#2f353b',
          900: '#1c2024',
        },
        ember: {
          50: '#fbeee6',
          100: '#f6dbc9',
          400: '#e8916a',
          500: '#dd7a4c',
          600: '#c2623a',
          700: '#a34f2e',
        },
      },
      fontFamily: {
        display: ['"Manrope"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        soft: '14px',
        card: '28px',
      },
      boxShadow: {
        rest: '0 20px 60px -24px rgba(28, 32, 36, 0.22), 0 8px 24px -12px rgba(28, 32, 36, 0.12)',
      },
    },
  },
  plugins: [],
}
