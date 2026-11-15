# The Boss

A personal AI assistant that lives on the Mac as a small animated elephant. It takes instructions in English, Tamil or Tanglish, watches mail, calendar, reminders and Canvas, and speaks up when something needs attention.

> Status: early V1. The elephant, the Today panel (mock data), typed chat and spoken replies work. Real Canvas, calendar and mail come next.

## What works today

- **Floating elephant**: an original cartoon elephant in a transparent, always-on-top window. Drag it anywhere. It has four animation states: idle, listening, thinking and talking.
- **Today panel**: click the elephant to open it beside the character. It has Needs you, Today, Ask, Park an idea, Recently and Controls sections. Press Escape or click elsewhere to close it. The deadlines and events are **mock data** for now.
- **Chat**: ask in English, தமிழ் or Tanglish and The Boss replies in the same language. Answers show in a speech bubble under the elephant and in a thread in the panel. The Boss knows your Today list, so "what's due tonight?" works.
- **Voice**: replies are read aloud with built-in macOS voices: Samantha for English, Vani for Tamil and Tanglish. The elephant talks while the voice plays.
- **Badge**: a red count on the elephant shows how many "Needs you" items are waiting. It drops as you act on them.
- **Right-click menu**: Mute voice, Quiet mode (no voice and no speech bubble), New chat and Quit. Mute and Quiet are remembered between launches.
- **Sessions**: chats are saved on your Mac and continue across restarts. A new chat starts after 30 quiet minutes, or click **+ New chat**. **Past chats** lets you reread or delete earlier chats.

## Tech

- [Tauri 2](https://tauri.app) (Rust) with React and TypeScript
- Chat uses the **Google Gemini API free tier** (`gemini-3.8-flash`, falling back to `gemini-3.5-flash-lite` when it's busy). It's called from the Rust side.
- Voice uses the macOS `say` command with the built-in **Samantha** and **Vani** voices. It's free and offline.
- The Gemini key is stored in the **macOS Keychain**. Chats are JSON files in `~/Library/Application Support/com.ramyar29.theboss/chats/`.

> On the free tier, Google may use what you send to improve its products. Each question sends the current chat and your Today list, never past chats.

## Run it

You need macOS, [Node.js](https://nodejs.org) and [Rust](https://rustup.rs).

```bash
npm install
npm run tauri dev
```

The first build takes a few minutes. Then:

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com) → **Get API key**.
2. Click the elephant, then go to **Controls → Gemini API key**, paste the key and click **Save**. If macOS asks for Keychain access, choose **Always Allow**.
3. Ask something in the **Ask** box.

To quit, right-click the elephant and choose **Quit The Boss**, or press Ctrl-C in the terminal running `npm run tauri dev`.

## How it's built

Every capability falls into one of three buckets:

| Bucket | Meaning | Default permission |
| --- | --- | --- |
| **Check** | Read information, never change anything (Canvas deadlines, mail, calendar, reminders) | Allowed without asking |
| **Do** | Act for the user (create a reminder, add a task, draft a message) | Low-risk actions allowed; anything that sends, deletes, spends or contacts a person needs a yes |
| **Remember** | Store and recall facts about the user | Allowed; the user can view, edit and delete memory |

## Roadmap

- **V1:** ~~character window~~, ~~Today panel~~, ~~typed chat in English, Tamil and Tanglish~~, ~~badge~~, ~~right-click menu~~, real read-only Canvas and calendar, proactive alerts, local memory.
- **V2:** reminders, to-do tools and idea parking (with confirmation), mail checking, message drafting with hand-off, voice input, ~~spoken replies~~ (done early).
- **V3:** plug in other apps through the Boss App Contract (MCP), smarter suggestions, daily digest, optional Android companion.

## Proposal

The full project proposal, including architecture, safety rules and open questions: [The Boss: Project Proposal](https://claude.ai/artifact/8B1v28L6G3fsKjX7fnbAVG)
