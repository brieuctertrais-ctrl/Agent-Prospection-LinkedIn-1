import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#1F2340", light: "#2A2F55", lighter: "#363C69", dark: "#161931" },
        gold: { DEFAULT: "#F5C451", dark: "#E0AE35" },
        cream: "#FFF6DC",
      },
      fontFamily: {
        display: ["'Bebas Neue'", "'Oswald'", "Impact", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
