const KEY = 'math-solver:history'
const MAX = 20

export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function saveHistory(items: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)))
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function addToHistory(items: string[], q: string): string[] {
  const t = q.trim()
  if (!t) return items
  return [t, ...items.filter((x) => x !== t)].slice(0, MAX)
}
