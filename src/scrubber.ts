export type ScrubResult = {
  text: string
  removed: number
}

const TAG_NAME = '[A-Za-z_][A-Za-z0-9_.:-]*'

/**
 * Parse one or more explicit tag pairs, for example:
 *   <tracker></tracker>, <state>optional example text</state>
 *
 * Different pairs must be comma-separated. Only the tag name is retained;
 * attributes in actual chat messages are still matched.
 */
export function parseTagPairs(input: string): string[] {
  const source = input.trim()
  if (!source) return []

  const pairPattern = new RegExp(
    `<(${TAG_NAME})(?:\\s[^<>]*?)?>[\\s\\S]*?<\\/\\1\\s*>`,
    'gi',
  )
  const names: string[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pairPattern.exec(source)) !== null) {
    const separator = source.slice(cursor, match.index)
    const validSeparator = names.length === 0
      ? /^\s*$/.test(separator)
      : /^\s*,\s*$/.test(separator)

    if (!validSeparator) {
      throw new Error(
        'Separate tracker pairs with commas, for example <tracker></tracker>, <state></state>.',
      )
    }

    names.push(match[1].toLowerCase())
    cursor = pairPattern.lastIndex
  }

  if (names.length === 0 || !/^\s*$/.test(source.slice(cursor))) {
    throw new Error(
      'Use complete tag pairs separated by commas, such as <tracker></tracker>, <state></state>.',
    )
  }

  return [...new Set(names)]
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
