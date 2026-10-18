export type ScrubResult = {
  text: string
  removed: number
}

const TAG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

/**
 * Parse comma-separated tag names, for example: tracker, state, details.
 * Users never need to enter angle brackets or closing tags.
 */
export function parseTagNames(input: string): string[] {
  const source = input.trim()
  if (!source) return []

  const names = source.split(',').map((name) => name.trim())
  if (names.some((name) => !TAG_NAME_PATTERN.test(name))) {
    throw new Error(
      'Enter tag names without < or >, separated by commas—for example: tracker, state, details.',
    )
  }

  return [...new Set(names.map((name) => name.toLowerCase()))]
}

export function scrubTaggedBlocks(text: string, tagNames: readonly string[]): ScrubResult {
  let scrubbed = text
  let removed = 0

  for (const tagName of tagNames) {
    const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const blockPattern = new RegExp(
      `<${escapedName}(?:\\s[^<>]*?)?\\s*>[\\s\\S]*?<\\/${escapedName}\\s*>`,
      'gi',
    )
    scrubbed = scrubbed.replace(blockPattern, () => {
      removed += 1
      return ''
    })
  }

  return { text: scrubbed, removed }
}
