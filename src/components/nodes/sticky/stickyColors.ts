export const STICKY_COLORS = [
  { bg: "bg-amber-200", headerBg: "bg-amber-300", name: "yellow" },
  { bg: "bg-rose-200", headerBg: "bg-rose-300", name: "pink" },
  { bg: "bg-emerald-200", headerBg: "bg-emerald-300", name: "green" },
  { bg: "bg-violet-200", headerBg: "bg-violet-300", name: "purple" },
  { bg: "bg-cyan-200", headerBg: "bg-cyan-300", name: "blue" },
  { bg: "bg-orange-200", headerBg: "bg-orange-300", name: "orange" },
] as const;

export type StickyColor = typeof STICKY_COLORS[number];

export const getNextColor = (currentColorName: string): StickyColor => {
  const currentIndex = STICKY_COLORS.findIndex((c) => c.name === currentColorName);
  const nextIndex = (currentIndex + 1) % STICKY_COLORS.length;
  return STICKY_COLORS[nextIndex];
};

export const getRandomColor = (): StickyColor => {
  return STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)];
};

export const getColorByName = (name: string): StickyColor => {
  return STICKY_COLORS.find((c) => c.name === name) || STICKY_COLORS[0];
};