import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f4f8',
          100: '#e8eef5',
          200: '#dce6f0',
          300: '#c8d6e5',
          400: '#b0c4d8',
          500: '#7a92b0',
          600: '#3d5478',
          700: '#2563b0',
          800: '#1a3a6b',
          900: '#12294d',
          950: '#0d1b2e',
        },
      },
      fontFamily: {
        sans: ['Barlow', 'sans-serif'],
        condensed: ['Barlow Condensed', 'sans-serif'],
        display: ['Rajdhani', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
