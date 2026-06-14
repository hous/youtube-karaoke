// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.html"],
  theme: {
    extend: {
      colors: {
        solstice: {
          bg: "#F7F4EB",
          dark: "#1A331E",
          green: "#4D7C2B",
          yellow: "#F1B83A",
          orange: "#E05A2B",
          brown: "#6B4423",
        },
      },
      fontFamily: {
        display: ["Yellowtail", "cursive"],
        body: ["Barlow Condensed", "sans-serif"],
      },
      boxShadow: {
        retro: "4px 4px 0px 0px #1A331E",
      },
    },
  },
  plugins: [],
};