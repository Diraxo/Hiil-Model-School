/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Hiil Model School brand — sampled from the school's signage (deep signage
        // red field, gold trim, white text). `brand` replaces the old `sky` accent
        // everywhere it meant "primary"; `gold` is the warm detail accent.
        brand: {
          50: "#fdf3f2",
          100: "#fbe4e2",
          200: "#f6c8c5",
          300: "#eda19c",
          400: "#e2716b",
          500: "#d1483f",
          600: "#c1272d", // primary — the sampled signage red
          700: "#a11f26",
          800: "#851d23",
          900: "#6f1c22",
          950: "#3d0d0f",
        },
        gold: {
          50: "#fdf8ec",
          100: "#faedcc",
          200: "#f4d992",
          300: "#eec25c",
          400: "#e9a63c", // detail accent — the signage gold
          500: "#dc8a26",
          600: "#c26b1f",
          700: "#9c4e1d",
          800: "#7f3f1e",
          900: "#6b351c",
        },
      },
    },
  },
  plugins: [],
};
