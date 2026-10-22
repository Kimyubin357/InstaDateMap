import type { SVGProps } from "react";
const paths = {
  search: "m21 21-4.6-4.6M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
  settings: "M9.72 4.54 10.26 2.15h3.48l.54 2.39 1.38.57 2.08-1.3 2.45 2.45-1.3 2.08.57 1.38 2.39.54v3.48l-2.39.54-.57 1.38 1.3 2.08-2.45 2.45-2.08-1.3-1.38.57-.54 2.39h-3.48l-.54-2.39-1.38-.57-2.08 1.3-2.45-2.45 1.3-2.08-.57-1.38-2.39-.54v-3.48l2.39-.54.57-1.38-1.3-2.08 2.45-2.45 2.08 1.3 1.38-.57ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  sliders: "M3 5h9m4 0h5M3 12h3m4 0h11M3 19h12m4 0h2M12 2v6M6 9v6m9 1v6",
  chevron: "m9 5 7 7-7 7", back: "m14 5-7 7 7 7", arrow: "M4 12h16m-6-6 6 6-6 6", close: "m6 6 12 12M6 18 18 6", plus: "M12 5v14M5 12h14",
  location: "M12 2v3m0 14v3M2 12h3m14 0h3M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  cup: "M4 5h13v7a6.5 6.5 0 0 1-13 0V5Zm13 1h2a3 3 0 1 1 0 6h-2M2 21h19",
  food: "M3 3v5a3 3 0 0 0 6 0V3M6 3v18M18 3c-3 2-4 6-4 10h5M19 3v18",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  copy: "M8 8h13v13H8V8ZM4 16H2V2h14v2", external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
  more: "M5 12h.01M12 12h.01M19 12h.01", eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  lock: "M6 10h12v12H6V10Zm2 0V6a4 4 0 0 1 8 0v4m-4 5v3", check: "m4 12 5 5L20 6",
  user: "M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 22v-3a9 9 0 0 1 18 0v3",
  link: "m10 13 4-4M9 15l-2 2a3.54 3.54 0 0 1-5-5l4-4a3.54 3.54 0 0 1 5 0m2 8a3.54 3.54 0 0 0 5 0l4-4a3.54 3.54 0 0 0-5-5l-2 2",
  image: "M2 3h20v18H2V3Zm0 14 6-7 6 7 4-4 4 4M17 7h.01", map: "m2 5 6-3 8 3 6-3v17l-6 3-8-3-6 3V5Zm6-3v17m8-14v17",
  list: "M8 6h14M8 12h14M8 18h14M2 6h.01M2 12h.01M2 18h.01",
  refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2",
} as const;
export default function Icon({ name, width = 22, height = width, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name]} /></svg>;
}
