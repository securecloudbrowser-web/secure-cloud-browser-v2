import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0B0F1A",
        primary: "#6366F1",
        secondary: "#06B6D4",
        tertiary: "#8B5CF6"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
};
export default config;
