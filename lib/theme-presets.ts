export type ThemeKey = "meeting" | "workshop" | "lounge" | "expo" | "gaming"

export const themePresets: Record<
  ThemeKey,
  {
    label: string
    colors: { floor: string; grid: string; banner: string; bannerText: string }
    // very simple props rectangles
    props: { x: number; y: number; w: number; h: number; color: string }[]
  }
> = {
  meeting: {
    label: "Sala de Reunião",
    colors: { floor: "#f8fafc", grid: "#e2e8f0", banner: "#0ea5e9", bannerText: "#ffffff" },
    props: [
      { x: 3 * 64, y: 2 * 64, w: 6 * 64, h: 2 * 64, color: "#e2e8f0" }, // mesa
      { x: 2 * 64, y: 6 * 64, w: 3 * 64, h: 1 * 64, color: "#d6d3d1" }, // aparador
    ],
  },
  workshop: {
    label: "Workshop",
    colors: { floor: "#fff7ed", grid: "#fed7aa", banner: "#f97316", bannerText: "#1c1917" },
    props: [
      { x: 2 * 64, y: 2 * 64, w: 3 * 64, h: 1 * 64, color: "#fed7aa" },
      { x: 8 * 64, y: 4 * 64, w: 4 * 64, h: 2 * 64, color: "#fde68a" },
    ],
  },
  lounge: {
    label: "Lounge",
    colors: { floor: "#fdf4ff", grid: "#f5d0fe", banner: "#a21caf", bannerText: "#ffffff" },
    props: [
      { x: 2 * 64, y: 5 * 64, w: 3 * 64, h: 1 * 64, color: "#f5d0fe" },
      { x: 9 * 64, y: 2 * 64, w: 3 * 64, h: 2 * 64, color: "#d8b4fe" },
    ],
  },
  expo: {
    label: "Stand de Feira",
    colors: { floor: "#ecfeff", grid: "#bae6fd", banner: "#06b6d4", bannerText: "#083344" },
    props: [
      { x: 3 * 64, y: 6 * 64, w: 5 * 64, h: 1 * 64, color: "#bae6fd" },
      { x: 10 * 64, y: 3 * 64, w: 3 * 64, h: 2 * 64, color: "#a5f3fc" },
    ],
  },
  gaming: {
    label: "Sala de Jogo",
    colors: { floor: "#0f172a", grid: "#1f2937", banner: "#22c55e", bannerText: "#052e16" },
    props: [
      { x: 2 * 64, y: 2 * 64, w: 4 * 64, h: 2 * 64, color: "#111827" },
      { x: 9 * 64, y: 5 * 64, w: 3 * 64, h: 1 * 64, color: "#111827" },
    ],
  },
}
