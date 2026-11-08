---
name: native-ui-conventions
description: Follow each platform's native UI conventions where possible, starting with per-platform text casing (Title Case on macOS, sentence case on Windows) and including platform-standard controls, shortcuts and terminology. Use when writing or reviewing UI text, menus, buttons or dialogs in a macOS, Windows, Linux, iOS or Android app, or a cross-platform desktop or mobile app.
---

# Native UI conventions

Make the UI look and behave the way each platform's own apps do, where the framework allows. When the platform's guidelines and a custom design disagree, follow the platform unless the user chose otherwise. Web pages follow the site's own style guide instead.

## 1. Case UI text per platform

- **macOS:** Title Case for menus, menu items, buttons and window titles, per Apple's Human Interface Guidelines. Checkbox and radio button labels and descriptive text use sentence case.
- **Windows:** sentence case for nearly everything (buttons, menus, titles, labels), per Microsoft's Windows app guidelines.
- **Other platforms:** look up and follow that platform's own guideline rather than guessing; they differ by element.
- In cross-platform apps, keep separate strings per platform where the framework allows (for example platform-specific resource files), rather than one casing everywhere. Don't convert case automatically: Title Case keeps short words lowercase and proper names keep their own casing, which a transform gets wrong.

## 2. Follow the platform's other standards

- Use the platform's standard controls, dialogs and menus over custom-built ones where they fit (native menu bar on macOS, system file pickers, standard settings windows).
- Use the platform's conventions for keyboard shortcuts (Cmd on macOS, Ctrl on Windows and Linux), button order in dialogs, window controls, icons and terminology (for example Settings on current macOS and Windows, Quit or Exit, Trash or Recycle Bin, as the platform names them).
- Respect system settings: light and dark mode, accent color, text size and reduced motion.

## Reporting

When reviewing, list each string or control that departs from the platform's convention, the platform, and the fix.
