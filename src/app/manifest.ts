import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "데이트맵",
    short_name: "데이트맵",
    description: "우리가 같이 가보고 싶은 곳",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4efdf",
    theme_color: "#f4efdf",
    icons: [
      { src: "/icons/canvas-heart-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/canvas-heart-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
