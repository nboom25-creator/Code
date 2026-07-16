// Blue -> green -> yellow -> red colormap for heat maps and FEA fields.

export function colormap(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  // piecewise: blue(0,0,1) -> green(0,1,0) -> yellow(1,1,0) -> red(1,0,0)
  if (x < 1 / 3) {
    const u = x * 3;
    return [0, u, 1 - u];
  }
  if (x < 2 / 3) {
    const u = (x - 1 / 3) * 3;
    return [u, 1, 0];
  }
  const u = (x - 2 / 3) * 3;
  return [1, 1 - u, 0];
}

export const NO_DATA_COLOR: [number, number, number] = [0.45, 0.45, 0.5];

export function cssColor(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
}

/** CSS gradient stops for the legend bar. */
export function legendGradient(): string {
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    stops.push(`${cssColor(colormap(i / 10))} ${i * 10}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
