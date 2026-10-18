// src/scrubber.ts
var TAG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
function parseTagNames(input) {
  const source = input.trim();
  if (!source) return [];
  const names = source.split(",").map((name) => name.trim());
  if (names.some((name) => !TAG_NAME_PATTERN.test(name))) {
    throw new Error(
      "Enter tag names without < or >, separated by commas\u2014for example: tracker, state, details."
    );
  }
  return [...new Set(names.map((name) => name.toLowerCase()))];
}
function scrubTaggedBlocks(text, tagNames) {
  let scrubbed = text;
  let removed = 0;
  for (const tagName of tagNames) {
    const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockPattern = new RegExp(
      `<${escapedName}(?:\\s[^<>]*?)?\\s*>[\\s\\S]*?<\\/${escapedName}\\s*>`,
      "gi"
    );
    scrubbed = scrubbed.replace(blockPattern, () => {
      removed += 1;
      return "";
    });
  }
  return { text: scrubbed, removed };
}

// src/backend.ts
var CONFIG_PATH = "config.json";
var DEFAULT_CONFIG = {
  messageLimit: 20,
  tagNames: ""
};
var MAX_MESSAGES = 1e3;
function normalizeConfig(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG };
  const candidate = value;
  const numericLimit = Number(candidate.messageLimit);
  const messageLimit = Number.isFinite(numericLimit) ? Math.min(MAX_MESSAGES, Math.max(1, Math.trunc(numericLimit))) : DEFAULT_CONFIG.messageLimit;
  const storedTagNames = typeof candidate.tagNames === "string" ? candidate.tagNames : typeof candidate.tagPairs === "string" ? migrateLegacyTagPairs(candidate.tagPairs) : "";
  return {
    messageLimit,
    tagNames: storedTagNames
  };
}
function migrateLegacyTagPairs(input) {
  if (!input.includes("<") && !input.includes(">")) return input;
  const names = [];
  const legacyPair = /<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*?)?>[\s\S]*?<\/\1\s*>/gi;
  let remainder = input;
  let match;
  while ((match = legacyPair.exec(input)) !== null) {
    names.push(match[1].toLowerCase());
    remainder = remainder.replace(match[0], "");
  }
  return names.length > 0 && /^[\s,]*$/.test(remainder) ? [...new Set(names)].join(", ") : input;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function loadConfig(userId) {
  const stored = await spindle.userStorage.getJson(CONFIG_PATH, {
    fallback: DEFAULT_CONFIG,
    userId
  });
  return normalizeConfig(stored);
}
async function saveConfig(config, userId) {
  await spindle.userStorage.setJson(CONFIG_PATH, config, { indent: 2, userId });
}
async function scrubActiveChat(config, userId) {
  const tagNames = parseTagNames(config.tagNames);
  if (tagNames.length === 0) {
    throw new Error("Enter at least one tag name before scrubbing.");
  }
  const activeChat = await spindle.chats.getActive(userId);
  if (!activeChat) {
    throw new Error("Open a chat before running Tracker Scrubber.");
  }
  const allMessages = await spindle.chat.getMessages(activeChat.id);
  const recentMessages = allMessages.slice(-config.messageLimit);
  let changedMessages = 0;
  let removedBlocks = 0;
  let failedMessages = 0;
  for (const message of recentMessages) {
    try {
      const currentActiveChat = await spindle.chats.getActive(userId);
      if (!currentActiveChat || currentActiveChat.id !== activeChat.id) {
        throw new Error("The active chat changed while scrubbing; the operation was stopped.");
      }
      if (Array.isArray(message.swipes) && message.swipes.length > 0) {
        let messageRemoved = 0;
        const scrubbedSwipes = message.swipes.map((swipe) => {
          const result2 = scrubTaggedBlocks(swipe, tagNames);
          messageRemoved += result2.removed;
          return result2.text;
        });
        if (messageRemoved > 0) {
          await spindle.chat.updateMessage(activeChat.id, message.id, {
            swipes: scrubbedSwipes
          });
          removedBlocks += messageRemoved;
          changedMessages += 1;
        }
        continue;
      }
      const result = scrubTaggedBlocks(message.content, tagNames);
      if (result.removed > 0) {
        await spindle.chat.updateMessage(activeChat.id, message.id, {
          content: result.text
        });
        removedBlocks += result.removed;
        changedMessages += 1;
      }
    } catch (error) {
      if (errorMessage(error).includes("active chat changed")) throw error;
      failedMessages += 1;
      spindle.log.error(`Failed to scrub message ${message.id}: ${errorMessage(error)}`);
    }
  }
  return {
    chatName: activeChat.name,
    examinedMessages: recentMessages.length,
    changedMessages,
    removedBlocks,
    failedMessages
  };
}
spindle.onFrontendMessage(async (rawPayload, userId) => {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const requestId = typeof payload.requestId === "string" ? payload.requestId : void 0;
  try {
    if (payload.type === "get_config") {
      const config = await loadConfig(userId);
      spindle.sendToFrontend({ type: "config", requestId, config }, userId);
      return;
    }
    if (payload.type === "save_config") {
      await saveConfig(normalizeConfig(payload.config), userId);
      return;
    }
    if (payload.type === "scrub") {
      const config = normalizeConfig(payload.config);
      await saveConfig(config, userId);
      const result = await scrubActiveChat(config, userId);
      spindle.sendToFrontend({ type: "scrub_result", requestId, result }, userId);
    }
  } catch (error) {
    spindle.log.error(`Tracker Scrubber error: ${errorMessage(error)}`);
    spindle.sendToFrontend(
      { type: "scrub_error", requestId, error: errorMessage(error) },
      userId
    );
  }
});
spindle.log.info("Tracker Scrubber loaded");
