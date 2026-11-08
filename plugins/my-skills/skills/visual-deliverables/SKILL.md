---
name: visual-deliverables
description: How to deliver mock-ups, screenshots and screen recordings for visual changes - share them in chat (Playwright screenshots for websites), never commit them or put them in a PR body, never push a branch or open a PR just to make them, mp4 not webm, and use the installed design plugins. Use when planning, building or handing over any UI, website or other visual change.
---

# Visual deliverables

## 1. Before building: mock-ups

- Make mock-ups of every visual change before building it, and share them in chat for the owner to pick from or approve.
- Use the design plugins and skills installed in the session for UI work (look for design, frontend, accessibility or platform-specific design skills in the skill list) and follow the repo's design source of truth if it has one (for example `DESIGN.md`).

## 2. After building: screenshots

- For website changes, capture screenshots of the change with Playwright (desktop and mobile widths where the layout differs), and share them in chat.
- For other UI, capture the change the way the platform allows (simulator, emulator or app screenshots) and share those.

## 3. Where they go

- Share mock-ups, screenshots and videos in chat only.
- Never commit them to the repo or a separate branch, and never embed them in the PR body.
- Never push a temporary branch or open a PR just to produce or host mock-ups or screenshots. If a CI workflow already renders them, the owner can find them in the workflow run; say which run.
- Keep the files in a scratch or output folder outside the repo's working tree, so they can't be committed by accident.

## 4. Video

- Deliver every screen recording as mp4 with H.264 video, never webm. Playwright records webm, so convert it before sharing, for example `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4`.
