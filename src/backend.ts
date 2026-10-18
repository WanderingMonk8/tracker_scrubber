import type { SpindleAPI } from 'lumiverse-spindle-types'
import { parseTagNames, scrubTaggedBlocks } from './scrubber'

type CurrentChatMessage = {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  extra: Record<string, unknown>
  metadata?: Record<string, unknown>
  swipe_id: number
  swipes: string[]
  swipe_dates: number[]
}

type CurrentSpindleAPI = Omit<SpindleAPI, 'chat' | 'sendToFrontend'> & {
  chat: {
    getMessages(chatId: string): Promise<CurrentChatMessage[]>
    updateMessage(
      chatId: string,
      messageId: string,
      patch: {
        content?: string
        metadata?: Record<string, unknown>
        swipes?: string[]
        swipe_id?: number
        swipe_dates?: number[]
        skipChunkRebuild?: boolean
      },
    ): Promise<void>
  }
  sendToFrontend(payload: unknown, userId?: string): void
}

// These fields are present in the current Spindle docs but not yet in the
// latest published type package (0.1.9), so keep the compatibility shim local.
declare const spindle: CurrentSpindleAPI

type TrackerScrubberConfig = {
  messageLimit: number
  tagNames: string
}

type FrontendPayload = {
  type?: unknown
  requestId?: unknown
  config?: unknown
}

const CONFIG_PATH = 'config.json'
const DEFAULT_CONFIG: TrackerScrubberConfig = {
  messageLimit: 20,
  tagNames: '',
}
const MAX_MESSAGES = 1000

function normalizeConfig(value: unknown): TrackerScrubberConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CONFIG }

  const candidate = value as Partial<TrackerScrubberConfig> & { tagPairs?: unknown }
  const numericLimit = Number(candidate.messageLimit)
  const messageLimit = Number.isFinite(numericLimit)
    ? Math.min(MAX_MESSAGES, Math.max(1, Math.trunc(numericLimit)))
    : DEFAULT_CONFIG.messageLimit

  const storedTagNames = typeof candidate.tagNames === 'string'
    ? candidate.tagNames
    : typeof candidate.tagPairs === 'string'
      ? migrateLegacyTagPairs(candidate.tagPairs)
      : ''

  return {
    messageLimit,
    tagNames: storedTagNames,
  }
}

function migrateLegacyTagPairs(input: string): string {
  if (!input.includes('<') && !input.includes('>')) return input

  const names: string[] = []
  const legacyPair = /<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*?)?>[\s\S]*?<\/\1\s*>/gi
  let remainder = input
  let match: RegExpExecArray | null

  while ((match = legacyPair.exec(input)) !== null) {
    names.push(match[1].toLowerCase())
    remainder = remainder.replace(match[0], '')
  }

  return names.length > 0 && /^[\s,]*$/.test(remainder)
    ? [...new Set(names)].join(', ')
    : input
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadConfig(userId: string): Promise<TrackerScrubberConfig> {
  const stored = await spindle.userStorage.getJson<unknown>(CONFIG_PATH, {
    fallback: DEFAULT_CONFIG,
    userId,
  })
  return normalizeConfig(stored)
}

async function saveConfig(config: TrackerScrubberConfig, userId: string): Promise<void> {
  await spindle.userStorage.setJson(CONFIG_PATH, config, { indent: 2, userId })
}

async function scrubActiveChat(config: TrackerScrubberConfig, userId: string) {
  const tagNames = parseTagNames(config.tagNames)
  if (tagNames.length === 0) {
    throw new Error('Enter at least one tag name before scrubbing.')
  }

  const activeChat = await spindle.chats.getActive(userId)
  if (!activeChat) {
    throw new Error('Open a chat before running Tracker Scrubber.')
  }

  const allMessages = await spindle.chat.getMessages(activeChat.id)
  const recentMessages = allMessages.slice(-config.messageLimit)
  let changedMessages = 0
  let removedBlocks = 0
  let failedMessages = 0

  for (const message of recentMessages) {
    try {
      // Never continue mutating a chat that is no longer active. This check is
      // intentionally inside the loop because a user can switch chats while a
      // larger scrub is running.
      const currentActiveChat = await spindle.chats.getActive(userId)
      if (!currentActiveChat || currentActiveChat.id !== activeChat.id) {
        throw new Error('The active chat changed while scrubbing; the operation was stopped.')
      }

      if (Array.isArray(message.swipes) && message.swipes.length > 0) {
        let messageRemoved = 0
        const scrubbedSwipes = message.swipes.map((swipe) => {
          const result = scrubTaggedBlocks(swipe, tagNames)
          messageRemoved += result.removed
          return result.text
        })

        if (messageRemoved > 0) {
          await spindle.chat.updateMessage(activeChat.id, message.id, {
            swipes: scrubbedSwipes,
          })
          removedBlocks += messageRemoved
          changedMessages += 1
        }
        continue
      }

      const result = scrubTaggedBlocks(message.content, tagNames)
      if (result.removed > 0) {
        await spindle.chat.updateMessage(activeChat.id, message.id, {
          content: result.text,
        })
        removedBlocks += result.removed
        changedMessages += 1
      }
    } catch (error) {
      if (errorMessage(error).includes('active chat changed')) throw error
      failedMessages += 1
      spindle.log.error(`Failed to scrub message ${message.id}: ${errorMessage(error)}`)
    }
  }

  return {
    chatName: activeChat.name,
    examinedMessages: recentMessages.length,
    changedMessages,
    removedBlocks,
    failedMessages,
  }
}

spindle.onFrontendMessage(async (rawPayload: unknown, userId: string) => {
  const payload = (rawPayload && typeof rawPayload === 'object'
    ? rawPayload
    : {}) as FrontendPayload
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : undefined

  try {
    if (payload.type === 'get_config') {
      const config = await loadConfig(userId)
      spindle.sendToFrontend({ type: 'config', requestId, config }, userId)
      return
    }

    if (payload.type === 'save_config') {
      await saveConfig(normalizeConfig(payload.config), userId)
      return
    }

    if (payload.type === 'scrub') {
      const config = normalizeConfig(payload.config)
      await saveConfig(config, userId)
      const result = await scrubActiveChat(config, userId)
      spindle.sendToFrontend({ type: 'scrub_result', requestId, result }, userId)
    }
  } catch (error) {
    spindle.log.error(`Tracker Scrubber error: ${errorMessage(error)}`)
    spindle.sendToFrontend(
      { type: 'scrub_error', requestId, error: errorMessage(error) },
      userId,
    )
  }
})

spindle.log.info('Tracker Scrubber loaded')
