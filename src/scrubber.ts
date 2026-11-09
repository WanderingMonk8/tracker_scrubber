export type ScrubResult = {
  text: string
  removed: number
}

export type TagPair = {
  open: string
  close: string
}

const TAG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

/**
 * Parse comma-separated tag pairs, for example: tracker, state, o_ledger/o_l.
 * A plain name removes `<name>...</name>`. An `open/close` pair removes
 * `<open>...</close>`, which supports asymmetric tags. Users never need to
 * enter angle brackets.
 */
export function parseTagPairs(input: string): TagPair[] {
  const source = input.trim()
  if (!source) return []

  const pairs: TagPair[] = []
  const seen = new Set<string>()

  for (const entry of source.split(',')) {
    const parts = entry.trim().split('/').map((part) => part.trim())
    if (parts.length > 2 || parts.some((part) => !TAG_NAME_PATTERN.test(part))) {
      throw new Error(
        'Enter tag names without < or >, separated by commas. For tags with different opening and closing names, use open/close—for example: tracker, state, o_ledger/o_l.',
      )
    }

    const open = parts[0].toLowerCase()
    const close = (parts[1] ?? parts[0]).toLowerCase()
    const key = `${open}/${close}`
    if (seen.has(key)) continue

    seen.add(key)
    pairs.push({ open, close })
  }

  return pairs
}

/**
 * Parse comma-separated opening tag names. Kept for callers that only need the
 * symmetric names; asymmetric pairs are represented by their opening name.
 */
export function parseTagNames(input: string): string[] {
  return [...new Set(parseTagPairs(input).map((pair) => pair.open))]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function scrubTaggedBlocks(
  text: string,
  tagPairs: readonly (string | TagPair)[],
): ScrubResult {
  let scrubbed = text
  let removed = 0

  for (const tagPair of tagPairs) {
    const { open, close } =
      typeof tagPair === 'string'
        ? { open: tagPair, close: tagPair }
        : tagPair
    const escapedOpen = escapeRegExp(open)
    const blockPattern = new RegExp(
      // Stop at another opening tag of the same name so an unclosed or
      // differently closed block cannot swallow the blocks that follow it.
      `<${escapedOpen}(?:\\s[^<>]*?)?\\s*>(?:(?!<${escapedOpen}(?:\\s|>))[\\s\\S])*?<\\/${escapeRegExp(close)}\\s*>`,
      'gi',
    )
    scrubbed = scrubbed.replace(blockPattern, () => {
      removed += 1
      return ''
    })
  }

  return { text: scrubbed, removed }
}
