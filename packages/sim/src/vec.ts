export interface Vec3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const dist2d = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

export const len2d = (x: number, z: number): number => Math.hypot(x, z);

export function norm2d(x: number, z: number): { x: number; z: number } {
  const l = len2d(x, z);
  return l < 1e-8 ? { x: 0, z: 0 } : { x: x / l, z: z / l };
}
