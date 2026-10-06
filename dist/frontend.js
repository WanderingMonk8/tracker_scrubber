// src/scrubber.ts
var TAG_NAME = "[A-Za-z_][A-Za-z0-9_.:-]*";
function parseTagPairs(input) {
  const source = input.trim();
  if (!source) return [];
  const pairPattern = new RegExp(
    `<(${TAG_NAME})(?:\\s[^<>]*?)?>[\\s\\S]*?<\\/\\1\\s*>`,
    "gi"
  );
  const names = [];
  let cursor = 0;
  let match;
  while ((match = pairPattern.exec(source)) !== null) {
    const separator = source.slice(cursor, match.index);
    const validSeparator = names.length === 0 ? /^\s*$/.test(separator) : /^\s*,\s*$/.test(separator);
    if (!validSeparator) {
      throw new Error(
        "Separate tracker pairs with commas, for example <tracker></tracker>, <state></state>."
      );
    }
    names.push(match[1].toLowerCase());
    cursor = pairPattern.lastIndex;
  }
  if (names.length === 0 || !/^\s*$/.test(source.slice(cursor))) {
    throw new Error(
      "Use complete tag pairs separated by commas, such as <tracker></tracker>, <state></state>."
    );
  }
  return [...new Set(names)];
}

// src/frontend.ts
var DEFAULT_CONFIG = { messageLimit: 20, tagPairs: "" };
function makeElement(tagName, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  return element;
}
function setup(ctx) {
  ctx.deferReady();
  const removeStyle = ctx.dom.addStyle(`
    .tracker-scrubber {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px;
      color: var(--lumiverse-text);
    }
    .tracker-scrubber__intro {
      margin: 0;
      color: var(--lumiverse-text-muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .tracker-scrubber__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tracker-scrubber__label {
      font-size: 13px;
      font-weight: 600;
    }
    .tracker-scrubber__hint {
      color: var(--lumiverse-text-muted);
      font-size: 11px;
      line-height: 1.4;
    }
    .tracker-scrubber input,
    .tracker-scrubber textarea {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      background: var(--lumiverse-fill);
      color: var(--lumiverse-text);
      font: inherit;
      font-size: 13px;
      padding: 9px 10px;
    }
    .tracker-scrubber textarea {
      min-height: 132px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      line-height: 1.5;
    }
    .tracker-scrubber input:focus,
    .tracker-scrubber textarea:focus {
      border-color: var(--lumiverse-accent);
      outline: 2px solid color-mix(in srgb, var(--lumiverse-accent) 25%, transparent);
      outline-offset: 1px;
    }
    .tracker-scrubber__button {
      min-height: 40px;
      border: 0;
      border-radius: var(--lumiverse-radius);
      background: var(--lumiverse-accent);
      color: var(--lumiverse-accent-foreground, white);
      cursor: pointer;
      font: inherit;
      font-weight: 650;
      padding: 10px 14px;
    }
    .tracker-scrubber__button:hover:not(:disabled) { filter: brightness(1.08); }
    .tracker-scrubber__button:disabled { cursor: wait; opacity: 0.6; }
    .tracker-scrubber__status {
      min-height: 20px;
      border-radius: var(--lumiverse-radius);
      font-size: 12px;
      line-height: 1.45;
      padding: 9px 10px;
    }
    .tracker-scrubber__status:empty { display: none; }
    .tracker-scrubber__status--info { background: var(--lumiverse-fill-subtle); }
    .tracker-scrubber__status--success {
      background: color-mix(in srgb, #22c55e 14%, transparent);
      color: var(--lumiverse-text);
    }
    .tracker-scrubber__status--error {
      background: color-mix(in srgb, #ef4444 14%, transparent);
      color: var(--lumiverse-text);
    }
  `);
  const tab = ctx.ui.registerDrawerTab({
    id: "tracker-scrubber",
    title: "Tracker Scrubber",
    shortName: "Scrubber",
    headerTitle: "Tracker Scrubber",
    description: "Remove tracker blocks from recent chat messages",
    keywords: ["tracker", "scrub", "clean", "history", "preset"],
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 15 6 6h8l4-4-10-10z"/><path d="m14 10 3-3"/><path d="M6 18h8"/></svg>'
  });
  const panel = makeElement("div", "tracker-scrubber");
  const intro = makeElement("p", "tracker-scrubber__intro");
  intro.textContent = "Permanently remove configured tracker blocks from the newest messages in the active chat.";
  const limitField = makeElement("div", "tracker-scrubber__field");
  const limitLabel = makeElement("label", "tracker-scrubber__label");
  limitLabel.textContent = "Messages to scan";
  const limitInput = makeElement("input");
  limitInput.type = "number";
  limitInput.min = "1";
  limitInput.max = "1000";
  limitInput.step = "1";
  limitInput.value = String(DEFAULT_CONFIG.messageLimit);
  limitInput.id = "tracker-scrubber-limit";
  limitLabel.htmlFor = limitInput.id;
  const limitHint = makeElement("span", "tracker-scrubber__hint");
  limitHint.textContent = "Starts at the most recent message and works backwards. Default: 20.";
  limitField.append(limitLabel, limitInput, limitHint);
  const tagsField = makeElement("div", "tracker-scrubber__field");
  const tagsLabel = makeElement("label", "tracker-scrubber__label");
  tagsLabel.textContent = "Tracker tag pairs";
  const tagsInput = makeElement("textarea");
  tagsInput.id = "tracker-scrubber-tags";
  tagsInput.placeholder = "<tracker></tracker>, <state></state>";
  tagsInput.spellcheck = false;
  tagsLabel.htmlFor = tagsInput.id;
  const tagsHint = makeElement("span", "tracker-scrubber__hint");
  tagsHint.textContent = "Separate complete tag pairs with commas. Changes save automatically. Matching is case-insensitive and includes multiline contents.";
  tagsField.append(tagsLabel, tagsInput, tagsHint);
  const scrubButton = makeElement("button", "tracker-scrubber__button");
  scrubButton.type = "button";
  scrubButton.textContent = "Scrub active chat";
  const status = makeElement("div", "tracker-scrubber__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(intro, limitField, tagsField, scrubButton, status);
  tab.root.replaceChildren(panel);
  let hasUserEdited = false;
  let saveTimer;
  let pendingRequestId;
  let requestTimer;
  const readConfig = () => ({
    messageLimit: Math.min(1e3, Math.max(1, Math.trunc(Number(limitInput.value) || 20))),
    tagPairs: tagsInput.value
  });
  const setStatus = (message, kind = "info") => {
    status.textContent = message;
    status.className = `tracker-scrubber__status tracker-scrubber__status--${kind}`;
  };
  const queueSave = () => {
    hasUserEdited = true;
    if (saveTimer !== void 0) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      ctx.sendToBackend({ type: "save_config", config: readConfig() });
      saveTimer = void 0;
    }, 350);
  };
  limitInput.addEventListener("input", queueSave);
  tagsInput.addEventListener("input", queueSave);
  scrubButton.addEventListener("click", async () => {
    const config = readConfig();
    limitInput.value = String(config.messageLimit);
    try {
      const tags = parseTagPairs(config.tagPairs);
      if (tags.length === 0) throw new Error("Enter at least one complete tag pair.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
      tagsInput.focus();
      return;
    }
    const { confirmed } = await ctx.ui.showConfirm({
      title: "Scrub tracker blocks?",
      message: `This permanently edits up to ${config.messageLimit} recent messages and all of their swipe variants in the active chat.`,
      variant: "warning",
      confirmLabel: "Scrub messages"
    });
    if (!confirmed) return;
    pendingRequestId = crypto.randomUUID();
    scrubButton.disabled = true;
    setStatus("Scanning the active chat\u2026");
    ctx.sendToBackend({ type: "scrub", requestId: pendingRequestId, config });
    requestTimer = window.setTimeout(() => {
      pendingRequestId = void 0;
      scrubButton.disabled = false;
      setStatus("The scrubber did not respond. Check that the extension permissions are enabled.", "error");
    }, 3e4);
  });
  const unsubscribeBackend = ctx.onBackendMessage((rawPayload) => {
    const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
    if (payload.type === "config" && payload.config && !hasUserEdited) {
      limitInput.value = String(payload.config.messageLimit ?? DEFAULT_CONFIG.messageLimit);
      tagsInput.value = payload.config.tagPairs ?? "";
      return;
    }
    if ((payload.type === "scrub_result" || payload.type === "scrub_error") && payload.requestId !== pendingRequestId) {
      return;
    }
    if (payload.type === "scrub_error") {
      if (requestTimer !== void 0) window.clearTimeout(requestTimer);
      pendingRequestId = void 0;
      scrubButton.disabled = false;
      setStatus(payload.error || "Tracker Scrubber encountered an unknown error.", "error");
      return;
    }
    if (payload.type === "scrub_result" && payload.result) {
      if (requestTimer !== void 0) window.clearTimeout(requestTimer);
      pendingRequestId = void 0;
      scrubButton.disabled = false;
      const result = payload.result;
      const failureNote = result.failedMessages ? ` ${result.failedMessages} message(s) could not be updated.` : "";
      setStatus(
        `Removed ${result.removedBlocks} tracker block(s) from ${result.changedMessages} of ${result.examinedMessages} scanned message(s) in \u201C${result.chatName}\u201D.${failureNote}`,
        result.failedMessages ? "error" : "success"
      );
    }
  });
  ctx.ready();
  ctx.sendToBackend({ type: "get_config", requestId: crypto.randomUUID() });
  return () => {
    if (saveTimer !== void 0) window.clearTimeout(saveTimer);
    if (requestTimer !== void 0) window.clearTimeout(requestTimer);
    unsubscribeBackend();
    tab.destroy();
    removeStyle();
  };
}
export {
  setup
};
