// Strict JSON with duplicate-key, prototype-key, depth and node limits.
export function parseBackupJson(text: string): unknown {
  let position = 0
  let nodes = 0
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  function fail(): never { throw new Error('JSON invalide, ambigu ou excessivement complexe dans la sauvegarde.') }
  function whitespace() { while (/[ \t\r\n]/.test(text[position] ?? '') && position < text.length) position++ }
  function string(): string {
    const start = position++
    let escaped = false
    while (position < text.length) {
      const char = text[position++]
      if (!escaped && char === '"') return JSON.parse(text.slice(start, position)) as string
      if (!escaped && char === '\\') escaped = true
      else escaped = false
    }
    return fail()
  }
  function value(depth: number): unknown {
    if (depth > 48 || ++nodes > 250000) fail()
    whitespace()
    const char = text[position]
    if (char === '"') return string()
    if (char === '{') {
      position++
      const result: Record<string, unknown> = {}
      const keys = new Set<string>()
      whitespace()
      if (text[position] === '}') { position++; return result }
      while (true) {
        whitespace()
        if (text[position] !== '"') fail()
        const key = string()
        if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail()
        keys.add(key)
        whitespace()
        if (text[position++] !== ':') fail()
        result[key] = value(depth + 1)
        whitespace()
        const next = text[position++]
        if (next === '}') return result
        if (next !== ',') fail()
      }
    }
    if (char === '[') {
      position++
      const result: unknown[] = []
      whitespace()
      if (text[position] === ']') { position++; return result }
      while (true) {
        result.push(value(depth + 1))
        whitespace()
        const next = text[position++]
        if (next === ']') return result
        if (next !== ',') fail()
      }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, position)) { position += token.length; return result }
    }
    numberPattern.lastIndex = position
    const number = numberPattern.exec(text)
    if (!number) return fail()
    position = numberPattern.lastIndex
    const result = Number(number[0])
    if (!Number.isFinite(result)) fail()
    return result
  }
  const result = value(0)
  whitespace()
  if (position !== text.length) fail()
  return result
}
