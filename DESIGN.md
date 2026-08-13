---
name: Ponder
description: A private journal for asking your past self questions and getting grounded, cited answers back.
colors:
  mist-50: "#f7f8f9"
  mist-100: "#eef0f2"
  mist-200: "#dfe3e7"
  mist-300: "#c7ccd2"
  mist-400: "#9aa1a9"
  mist-500: "#747d86"
  mist-600: "#5a636c"
  mist-700: "#454d55"
  mist-800: "#2f353b"
  mist-900: "#1c2024"
  ember-50: "#fbeee6"
  ember-100: "#f6dbc9"
  ember-400: "#e8916a"
  ember-500: "#dd7a4c"
  ember-600: "#c2623a"
  ember-700: "#a34f2e"
typography:
  display:
    fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 800
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
  entry:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontWeight: 400
rounded:
  soft: "14px"
  card: "28px"
components:
  button-primary:
    backgroundColor: "{colors.mist-900}"
    textColor: "#ffffff"
    rounded: "{rounded.soft}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.mist-700}"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.mist-900}"
    rounded: "{rounded.soft}"
    padding: "10px 14px"
  card-reflect:
    backgroundColor: "#ffffff"
    rounded: "{rounded.card}"
---

<!-- PARTIALLY IMPLEMENTED: tokens below are real, established while building the login screen and the main entries/composer screen. Search/Reflect still lives at /debug/search on the pre-redesign look — re-run /impeccable document once it's rebuilt as a real screen to capture full component coverage and generate the sidecar. -->

# Design System: Ponder

## Overview

**Creative North Star: "Looking Up Through the Mist"**

Ponder is built around a pause, not a destination — the stillness of lying in the grass looking up at a misty mountain sky, or Rodin's Thinker caught mid-thought. The interface holds two distinct textures that mirror the app's two real modes: writing, which stays close to the immediate and unfiltered, like a photograph taken mid-motion; and reflecting — browsing entries, searching, reading a synthesized answer — which is where the crafted, settled world of the design actually lives.

The palette is cool and overcast by default — a misted, gray-blue neutral, never a warm cream or a cold clinical gray — with a single warm ember accent that appears the way a red sweater stands out against a gray-green mountainside, or dusk light catches a tree line: rare, and always meaningful, never decorative.

Rejected explicitly: warm cream/parchment "cozy journal" tropes, gamified or app-store-generic voice-memo chrome (credits counters, gradient tiles as primary navigation), and anything that reads as a dashboard rather than a quiet, single-person space.

**Key Characteristics:**
- Two textures: raw and unpolished (writing) vs. soft and settled (reflecting)
- Cool misted-stone neutral ground; one warm ember accent, used only at meaningful moments
- Generous, river-stone-soft rounded corners on reflection surfaces; flat and sharp in the editor
- Gentle resting shadows, not hard borders, on reflection cards
- A rounded geometric sans for display type, a plain humanist sans for UI, monospace preserved for entries

## Colors

Cool and quiet by default; warmth is earned, not decorative.

### Primary
- **Ember** (a warm coral-gold — dusk light on treetops, a red sweater against gray mountains; `ember-500` #dd7a4c, with `ember-50`/`ember-100` as light washes and `ember-600`/`ember-700` for text-safe contrast): reserved for rare, meaningful moments — a grounded/cited answer, a success confirmation. Never used for routine UI chrome, buttons-by-default, or brand decoration.

### Neutral
- **Misted Stone** (a cool, overcast gray-blue scale, `mist-50` #f7f8f9 through `mist-900` #1c2024): the dominant background and surface color, replacing the current implementation's warm Tailwind stone. `mist-50`/`mist-100` for backgrounds, `mist-200`/`mist-300` for borders and dividers, `mist-600` for secondary/placeholder text (contrast-checked against `mist-50`).
- **Wet Slate** (`mist-800`/`mist-900`, dark cool-toned ink): primary text color.

### Named Rules
**The Single Ember Rule.** Ember appears at most once per screen, and only to mark something the user should actually notice as meaningful — never as a brand accent, a default button color, or decoration.

## Typography

**Display Font:** Manrope (extrabold, tight tracking), self-served via Google Fonts — a rounded geometric sans in the register of the reference moodboard's app headline; confident, warm-edged, not a sharp grotesk
**Body/UI Font:** the system-ui stack — this is an Operate-mode surface, not a Persuade one, so no second custom font is loaded for it
**Entry Font:** the system monospace stack, preserved from the current implementation — the closest thing to a raw, unfiltered transcript

**Character:** Confident but quiet. The display face is used sparingly — wordmark, empty states, section headers — never on every heading.

### Named Rules
**The Transcript Rule.** Entry content is always set in monospace. It isn't meant to look designed; that rawness is the point.

## Layout

The main screen is a persistent two-pane split, not a single column: a fixed 340px list pane (filter + entries) on the left, and a flexible composer pane on the right — closer to a mail or notes app than a page-scrolling document. This superseded the seed's original "never a sidebar" assumption once the real main-page brief was set; the constraint that survives is narrower and more specific than "no sidebar" — the *composer's* writing measure stays a single narrow column (`max-w-2xl`) even though the app shell around it is multi-pane, so long-form writing never stretches full-bleed.

On mobile, the two panes never show at once: the list and the composer each take the full viewport, and navigating between them (selecting an entry, tapping back) swaps which one is visible rather than compressing both onto the screen.

The login screen is a distinct, single-purpose layout (the atmosphere/composer split described under Overview) and isn't part of this app-shell grid.

## Elevation & Depth

Two depth languages for two textures. Reflection surfaces — the entry list, search and reflect results — use soft, diffuse ambient shadows: a resting weight, like a stone settled in shallow water, never a hard material drop-shadow. The editor (the current) stays flat, bordered, unshadowed — deliberately less finished than the surfaces around it.

### Named Rules
**The Resting Shadow Rule.** Shadows are soft and low-contrast, signaling settledness rather than elevation hierarchy. Never used in the editor.

## Shapes

Reflection surfaces use generous, river-stone-soft corner radii (`rounded-card`, 28px, for containers like the auth card; `rounded-soft`, 14px, for inputs and buttons) — noticeably larger than the current implementation's uniform 6px default. The editor keeps sharp, minimal corners, reinforcing the contrast between the two textures.

## Components

### Buttons
- **Shape:** `rounded-soft` (14px)
- **Primary:** `mist-900` background, white text, `10px 14px` padding, `font-semibold`
- **Hover:** `mist-700`
- **Disabled:** 50% opacity

### Inputs / Fields
- **Style:** white background, `mist-200` border, `rounded-soft`
- **Focus:** border shifts to `mist-500` plus a soft `mist-200` ring — neutral, not Ember; Ember is reserved for the outcome of an action, not the act of focusing a field

### Cards (reflection surfaces)
- **Corner style:** `rounded-card` (28px)
- **Background:** white
- **Shadow:** `shadow-rest` (a soft, offset, diffuse shadow defined in `tailwind.config.js` — never a hard or zero-offset shadow)
- **Border:** none; the shadow alone separates it from the page

### Confirmation / success state
- **Style:** `ember-50` icon badge with `ember-100` ring, `ember-600` icon stroke — the one place Ember appears on the surface, marking a completed meaningful action (e.g. "check your inbox" after a magic link is sent)

### List Item (entries list)
- **Style:** no border or shadow at rest; a plain `rounded-soft` row inside the list pane
- **Active/selected:** `mist-200` background at ~70% opacity — enough to read as "currently open," deliberately quieter than a colored highlight
- **Hover:** `mist-100` background

### Composer
- **Title row:** `font-display`, `text-2xl`, `font-extrabold` — the Notes-app-style "first line is the title" treatment, implemented as a separate title input joined with the body into one stored string, not a rich-text hack
- **Body:** monospace (The Transcript Rule applies), no border, grows with content rather than scrolling in a fixed box
- **Save state:** a plain text status ("Saving…" / "Saved" / "Not saved" in red) in place of a Save button — autosave is the default interaction, not an exception

## Do's and Don'ts

### Do:
- **Do** keep Ember to one meaningful appearance per screen (The Single Ember Rule).
- **Do** treat the editor/entry surface as intentionally rawer and flatter than the reflection surfaces around it.
- **Do** use soft, resting shadows on reflection cards instead of hard borders.
- **Do** keep the display font rare and purposeful; most text stays in the quiet UI face or the entry monospace.

### Don't:
- **Don't** use warm cream/parchment "cozy journal" tropes — the neutral ground is cool and misted, not warm paper.
- **Don't** add gamified or app-store-generic voice-memo chrome (credits counters, literal gradient action tiles) — the moodboard's app references are craft/atmosphere inspiration, not features to copy.
- **Don't** let the interface read as a dashboard; it's a quiet, single-person space.
