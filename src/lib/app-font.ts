import localFont from "next/font/local";

// The root layout and its independent error fallback use the same supplied font.
export const dahyun = localFont({
  src: "../../public/fonts/ownglyph-park-dahyun.woff2",
  variable: "--font-dahyun",
  weight: "400",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "size-adjust", value: "125%" }],
  fallback: ["Apple SD Gothic Neo", "sans-serif"],
});
