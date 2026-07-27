---
created: 2026-07-27T21:54:32.536Z
title: Research Telegram persistent menu button reliability
area: telegram-bot
files:
  - src/telegram/client.ts (setChatMenuButton, setMyCommands)
  - src/onboarding/ai-onboarding-agent.ts (finish_onboarding wiring, Phase 24)
---

## Problem

User reports the persistent Telegram menu button (added in v1.6 Phase 24:
`setChatMenuButton`/`setMyCommands`, chat-scoped for the owner's `/menu`,
`all_private_chats` default for clients' `/start`) doesn't show up consistently
for users. Not yet root-caused — Telegram's client-side menu button behavior
has known caching/refresh quirks (e.g. it may only refresh when a chat is
reopened, or per-client-version differences) that weren't investigated when
Phase 24 shipped (that phase implemented the Bot API calls correctly per the
API docs, but didn't research real-world client-side reliability).

User explicitly asked: "search online and investigate the best menu
implementation."

## Solution

TBD — needs actual research (not guessing) into:
- Whether `setChatMenuButton` requires anything beyond a one-time call (e.g.
  does it need to be re-set periodically, or after certain bot/webhook changes)
- Whether the `all_private_chats` scope reliably reaches brand-new client chats
  immediately vs. requiring the client to reopen/restart the chat
- Whether other/better mechanisms exist (e.g. reply keyboard vs. inline
  keyboard vs. the menu button specifically) for "always-available menu access"
  that Telegram bots commonly use
- Whether per-chat (`BotCommandScopeChat`) vs default scope has different
  reliability characteristics
