---
name: visual-deliverables
description: How to deliver mock-ups, screenshots and screen recordings for visual changes, such as sharing them in chat (Playwright screenshots for websites), never committing them or putting them in a PR body, never pushing a branch or opening a PR just to make them, mp4 rather than webm, and using the installed design plugins. Use when planning, building or handing over any UI, website or other visual change.
---

# Visual deliverables

These rules are for images and videos made so the user can review a change. Assets the change itself needs (README screenshots, store listing images, visual regression baselines) are part of the change and are committed like any other file.

## 1. Before building: mock-ups

- Make mock-ups of every visual change before building it, and share them in chat. Wait for the user's pick or approval before building, unless they said to go ahead.
- Use the design plugins and skills installed in the session for UI work (look for design, frontend, accessibility or platform-specific design skills in the skill list) and follow the repo's design source of truth if it has one (for example `DESIGN.md`).

## 2. After building: screenshots

- For website changes, capture screenshots of the change with Playwright (desktop and mobile widths where the layout differs), and share them in chat.
- For other UI, capture the change the way the platform allows (simulator, emulator or app screenshots) and share those.

## 3. Where they go

- Share review mock-ups, screenshots and videos in chat only.
- Never commit them to the repo or a separate branch, and never embed them in the PR body.
- Never push a temporary branch or open a PR just to produce or host them. If a CI workflow already renders them, the user can find them in the workflow run; say which run.
- Keep the files in a scratch or output folder outside the repo's working tree, so they can't be committed by accident.

## 4. Video

- Deliver every screen recording as mp4 with H.264 video, never webm. Playwright records webm, so convert it before sharing. Round the size to even numbers, which H.264 needs: `ffmpeg -i in.webm -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4`.
