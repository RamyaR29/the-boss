# The Boss

A personal AI assistant that lives on the Mac as a small animated character. It takes instructions by voice or typing in English, Tamil or Tanglish, watches mail, calendar, reminders and Canvas, and speaks up on its own when something needs attention.

> Status: planning. No code yet.

## What it does

Every capability falls into one of three buckets:

| Bucket | Meaning | Default permission |
| --- | --- | --- |
| **Check** | Read information, never change anything (Canvas deadlines, mail, calendar, reminders) | Allowed without asking |
| **Do** | Act for the user (create a reminder, add a task, draft a message) | Low-risk actions allowed; anything that sends, deletes, spends or contacts a person needs a yes |
| **Remember** | Store and recall facts about the user | Allowed; the user can view, edit and delete memory |

## Roadmap

- **V1:** character window with badge and Today panel, typed chat in English, Tamil and Tanglish, read-only Canvas and calendar, proactive alerts, local memory.
- **V2:** reminders, to-do tools and idea parking (with confirmation), mail checking, message drafting with hand-off, voice input and spoken replies.
- **V3:** plug in other apps through the Boss App Contract (MCP), smarter suggestions, daily digest, optional Android companion.

## Proposal

The full project proposal, including architecture, safety rules and open questions: [The Boss: Project Proposal](https://claude.ai/artifact/8B1v28L6G3fsKjX7fnbAVG)
