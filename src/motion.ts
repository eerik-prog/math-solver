import type { CSSProperties } from 'react'

/** Staggered entrance: the n-th element animates in slightly after the one before it (see `.rise` in index.css). */
export const rise = (i: number) => ({ '--i': i }) as CSSProperties

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
