import { useId } from 'react'

/** Make a React `useId()` value safe for HTML ids and SVG `url(#id)` references (letters, digits, `-`, `_`). */
export function toDomId(prefix: string, reactId: string): string {
  return `${prefix}-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`
}

/** Per-instance id, unique even when the same component is mounted several times. */
export function useDomId(prefix: string): string {
  return toDomId(prefix, useId())
}
