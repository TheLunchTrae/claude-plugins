---
name: native-ui-conventions
description: Follow each platform's native UI conventions where possible, starting with per-platform text casing (Title Case on macOS, sentence case on Windows) and including platform-standard controls, menus, shortcuts and layout. Use when writing or reviewing UI text, labels, menus, buttons or dialogs, or building UI for a desktop or mobile platform.
---

# Native UI conventions

Make the UI look and behave the way each platform's own apps do, where the framework allows. When the platform's guidelines and a custom design disagree, follow the platform unless the owner chose otherwise.

## 1. Case UI text per platform

- **macOS:** Title Case for menu items, buttons, window titles and other command labels, per Apple's Human Interface Guidelines.
- **Windows:** sentence case for nearly everything (buttons, menus, titles, labels), per Microsoft's Windows app guidelines.
- **Other platforms:** look up and follow that platform's own guideline rather than guessing; they differ by element.
- In cross-platform apps, keep strings per platform where the framework allows (platform-specific resource files, or a casing step at the string layer), rather than one casing everywhere. Product and proper names keep their own casing.

## 2. Follow the platform's other standards

- Use the platform's standard controls, dialogs and menus over custom-built ones where they fit (native menu bar on macOS, system file pickers, standard settings or preferences windows).
- Use the platform's conventions for keyboard shortcuts (Cmd on macOS, Ctrl on Windows and Linux), button order in dialogs, window controls, icons and terminology (for example Preferences or Settings, Quit or Exit, Trash or Recycle Bin, as the platform names them).
- Respect system settings: light and dark mode, accent color, text size and reduced motion.

## Reporting

When reviewing, list each string or control that departs from the platform's convention, the platform, and the fix.
