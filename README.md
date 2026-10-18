# Tracker Scrubber for Lumiverse

Tracker Scrubber removes preset-specific tracker blocks from recent messages in the currently active Lumiverse chat.

## Features

- Scans the newest 20 messages by default, working backwards. The limit is configurable from 1 to 1,000.
- Accepts plain tag names separated by commas—users do not enter angle brackets or closing tags:

  ```text
  tracker, state, inventory
  ```

- Removes each matching tag, all content inside it, and the closing tag. Matching is case-insensitive, spans multiple lines, and accepts attributes such as `<tracker type="status">`.
- Scrubs every swipe variant belonging to each scanned message, not only the currently selected swipe.
- Resolves the active chat at scrub time and never reads or modifies messages from any other chat. If the active chat changes while a scrub is running, the operation stops.
- Automatically saves the message limit and tag-pair configuration per Lumiverse user as the user types.
- Requires confirmation before changing chat history and reports how many blocks and messages were changed.

## Build

Requirements: Node.js 18 or newer.

```sh
npm install
npm run test
npm run build
```

The build creates `dist/backend.js` and `dist/frontend.js`, which are referenced by `spindle.json`.

## Install in Lumiverse

Install `https://github.com/WanderingMonk8/tracker_scrubber.git` through Lumiverse's Extensions panel. Lumiverse can also auto-build the TypeScript sources when `dist/` is absent, provided its host has Bun available.

Grant the requested permissions:

- `chats` — identifies the active chat.
- `chat_mutation` — reads and edits messages in that chat.

Open the **Tracker Scrubber** drawer tab, set the number of recent messages, enter comma-separated tag names (for example, `tracker, state, details`), and select **Scrub active chat**. Input is saved automatically.

> Scrubbing edits chat history permanently. Export or back up important chats first.

## Development

```sh
npm run typecheck
npm run test
npm run build
```

Before publishing a fork, update the author and repository URLs in `spindle.json`.
