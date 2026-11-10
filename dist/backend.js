// src/scrubber.ts
var TAG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
function parseTagPairs(input) {
  const source = input.trim();
  if (!source) return [];
  const pairs = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of source.split(",")) {
    const parts = entry.trim().split("/").map((part) => part.trim());
    if (parts.length > 2 || parts.some((part) => !TAG_NAME_PATTERN.test(part))) {
      throw new Error(
        "Enter tag names without < or >, separated by commas. For tags with different opening and closing names, use open/close\u2014for example: tracker, state, o_ledger/o_l."
      );
    }
    const open = parts[0].toLowerCase();
    const close = (parts[1] ?? parts[0]).toLowerCase();
    const key = `${open}/${close}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ open, close });
  }
  return pairs;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function scrubTaggedBlocks(text, tagPairs) {
  let scrubbed = text;
  let removed = 0;
  for (const tagPair of tagPairs) {
    const { open, close } = typeof tagPair === "string" ? { open: tagPair, close: tagPair } : tagPair;
    const escapedOpen = escapeRegExp(open);
    const blockPattern = new RegExp(
      // Stop at another opening tag of the same name so an unclosed or
      // differently closed block cannot swallow the blocks that follow it.
      `<${escapedOpen}(?:\\s[^<>]*?)?\\s*>(?:(?!<${escapedOpen}(?:\\s|>))[\\s\\S])*?<\\/${escapeRegExp(close)}\\s*>`,
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
  const tagPairs = parseTagPairs(config.tagNames);
  if (tagPairs.length === 0) {
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
          const result2 = scrubTaggedBlocks(swipe, tagPairs);
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
      const result = scrubTaggedBlocks(message.content, tagPairs);
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
  let responseRequestId;
  try {
    if (payload.type === "get_config") {
      const config = await loadConfig(userId);
      spindle.sendToFrontend({ type: "config", config }, userId);
      return;
    }
    if (payload.type === "save_config") {
      await saveConfig(normalizeConfig(payload.config), userId);
      return;
    }
    if (payload.type === "scrub") {
      responseRequestId = await spindle.uuid.v7();
      const config = normalizeConfig(payload.config);
      await saveConfig(config, userId);
      const result = await scrubActiveChat(config, userId);
      spindle.sendToFrontend({ type: "scrub_result", requestId: responseRequestId, result }, userId);
    }
  } catch (error) {
    spindle.log.error(`Tracker Scrubber error: ${errorMessage(error)}`);
    spindle.sendToFrontend(
      { type: "scrub_error", requestId: responseRequestId, error: errorMessage(error) },
      userId
    );
  }
});
spindle.log.info("Tracker Scrubber loaded");
