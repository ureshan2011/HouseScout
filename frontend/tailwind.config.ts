import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0d9488", dark: "#0f766e", light: "#5eead4" },
      },
    },
  },
  // iOS fires :hover on tap and leaves it stuck until the next tap elsewhere, so every
  // `hover:` style would stay painted on whatever was touched last. This wraps them in
  // @media (hover: hover), which touch devices don't match.
  future: { hoverOnlyWhenSupported: true },
  plugins: [],
};
export default config;
