# The Boss

A personal AI assistant that lives on the Mac as a small, clever elephant with round gold glasses and a tiny coral backpack. It takes instructions in English, Tamil or Tanglish, watches mail, calendar, reminders and Canvas, and speaks up when something needs attention.

> Status: early V1. The elephant, the Today panel, real Canvas deadlines, typed chat, spoken replies and local memory work. Real calendar and mail come next.

## What works today

- **Floating elephant**: an original lavender-gray elephant with round gold glasses and a tiny coral backpack, in a transparent, always-on-top window. Drag it anywhere. Its trunk points at you when you hover.
- **Moods**: its ears, trunk and front legs show how it feels.

  | Mood | When | How it looks |
  | --- | --- | --- |
  | Idle | Default | Gentle ear sway, hands resting |
  | Thinking | Waiting for an answer | One ear tilted, hand on chin, thought bubbles |
  | Talking | While it speaks | Mouth moves, small hand gestures |
  | Happy | Just after a reply | Ears lifted, smiling eyes, waves |
  | Confused | An error | Ears tilted out, a shrug, a "?" |
  | Celebrating | You approve a card or finish a Today item | Ears flap, stomp, both hands up |
  | Sleeping | 15 minutes with no activity | Lies low, ears droop, "z z z" (any click wakes it) |
  | Staring | An urgent alert is waiting (at most every 20 minutes) | Still, wide eyes, looking at you |
  | Listening | Reserved for voice input | Ears perk up |

  You can preview every mood under **Controls → Preview character**.
- **Personality**: calm, clever and warm, with a little mischief. Never childish.
- **Today panel**: click the elephant to open it beside the character. It has Needs you, Today, Ask, Park an idea, Recently and Controls sections. Press Escape or click elsewhere to close it. Canvas items are real; calendar, reminder and to-do items are still **mock data**.
- **Canvas deadlines (read-only)**: paste your private Canvas **Calendar Feed** link once and The Boss reads your assignments and course events from it.
  - Anything due today shows in **Today**; the next 7 days show under **Coming up**, grouped by day. Course events are labeled "Canvas event".
  - Assignments due within 24 hours become a red **Needs you** alert (badge, and the elephant stares at you). **Open in Canvas** opens the assignment; tick ✓ or **Dismiss** to clear it.
  - ✓ ticks and dismissals are remembered on your Mac. The Boss never changes anything in Canvas.
  - It checks on launch, every hour, and when you click **Refresh**.
- **Chat**: ask in English, தமிழ் or Tanglish and The Boss replies in the same language. Answers show in a speech bubble under the elephant and in a thread in the panel. The Boss knows your Today list and the coming week's Canvas items, so "what's due this week?" works.
- **Memory**: The Boss remembers short facts about you and uses them in answers.
  - Say "remember that…" (or நினைவில் வை, or "nyabagam vechuko") and it saves the fact. It may also note lasting facts you mention, like "my exam is in Room 204".
  - Tell it "actually it moved to Room 310" or "forget my exam room" to change or remove a fact. One fact can hold several names, like "Amma = Mom = அம்மா".
  - Every change shows under the reply (🧠 Noted / Updated / Forgot) with an **Undo**.
  - Open **Memory** in the panel to see everything, edit or delete a line, add one by hand, or **Forget everything**.
  - It never saves passwords, PINs or codes, ID, bank or card numbers, or health details, even if you ask.
- **Voice**: replies are read aloud with built-in macOS voices: Samantha for English, Vani for Tamil and Tanglish. The elephant talks while the voice plays.
- **Badge**: a red count on the elephant shows how many "Needs you" items are waiting. It drops as you act on them.
- **Right-click menu**: Mute voice, Quiet mode (no voice and no speech bubble), New chat and Quit. Mute and Quiet are remembered between launches.
- **Sessions**: chats are saved on your Mac and continue across restarts. A new chat starts after 30 quiet minutes, or click **+ New chat**. **Past chats** lets you reread or delete earlier chats.

## Tech

- [Tauri 2](https://tauri.app) (Rust) with React and TypeScript
- Chat uses the **Google Gemini API free tier** (`gemini-3.8-flash`, falling back to `gemini-3.5-flash-lite` when it's busy). It's called from the Rust side.
- Voice uses the macOS `say` command with the built-in **Samantha** and **Vani** voices. It's free and offline.
- Canvas is read from its iCalendar (.ics) **Calendar Feed** link, fetched and parsed in Rust.
- The Gemini key and the Canvas feed link are stored in the **macOS Keychain** and never sent back to the web view. Chats are JSON files in `~/Library/Application Support/com.ramyar29.theboss/chats/`, and memories are in `memory.json` in the same folder.

> On the free tier, Google may use what you send to improve its products. Each question sends the current chat, your Today list, the coming week's Canvas items and your memories, never past chats or your feed link.

## Run it

You need macOS, [Node.js](https://nodejs.org) and [Rust](https://rustup.rs).

```bash
npm install
npm run tauri dev
```

The first build takes a few minutes. Then:

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com) → **Get API key**.
2. Click the elephant, then go to **Controls → Gemini API key**, paste the key and click **Save**. If macOS asks for Keychain access, choose **Always Allow**.
3. To connect Canvas: in Canvas, open **Calendar** and click **Calendar Feed** (bottom right). Copy the link (right-click → **Copy Link Address** if clicking downloads a file). Paste it under **Controls → Canvas calendar feed** and click **Save**. The link works like a password, so don't share it.
4. Ask something in the **Ask** box.

To quit, right-click the elephant and choose **Quit The Boss**, or press Ctrl-C in the terminal running `npm run tauri dev`.

## How it's built

Every capability falls into one of three buckets:

| Bucket | Meaning | Default permission |
| --- | --- | --- |
| **Check** | Read information, never change anything (Canvas deadlines, mail, calendar, reminders) | Allowed without asking |
| **Do** | Act for the user (create a reminder, add a task, draft a message) | Low-risk actions allowed; anything that sends, deletes, spends or contacts a person needs a yes |
| **Remember** | Store and recall facts about the user | Allowed; the user can view, edit and delete memory |

## Roadmap

- **V1:** ~~character window~~, ~~Today panel~~, ~~typed chat in English, Tamil and Tanglish~~, ~~badge~~, ~~right-click menu~~, ~~real read-only Canvas~~, real read-only calendar, proactive alerts, ~~local memory~~.
- **V2:** reminders, to-do tools and idea parking (with confirmation), mail checking, message drafting with hand-off, voice input, ~~spoken replies~~ (done early).
- **V3:** plug in other apps through the Boss App Contract (MCP), smarter suggestions, daily digest, optional Android companion.

## Proposal

The full project proposal, including architecture, safety rules and open questions: [The Boss: Project Proposal](https://claude.ai/artifact/8B1v28L6G3fsKjX7fnbAVG)
