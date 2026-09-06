import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "momp max",
    short_name: "momp",
    description: "Веб-интерфейс для кодинг-агента momp (momp max)",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#151820",
    theme_color: "#151820",
    categories: ["developer", "productivity", "utilities"],
    lang: "ru",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Новая сессия",
        short_name: "Новая",
        description: "Начать новую сессию с агентом momp",
        url: "/?action=new-session",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
