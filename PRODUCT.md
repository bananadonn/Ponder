# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Currently a single real user: the developer, journaling for their own personal reflection. The data model and auth (Supabase, per-account RLS) support multiple accounts, but no other users are onboarded yet — design for one person's private archive, not a multi-tenant audience.

## Product Purpose

Ponder is a minimal markdown journaling app that lets you ask natural-language questions about your own past entries and get grounded, cited answers back — not just store and browse what you write. Success is a journal that's actually useful to look back on, not just a write-only archive.

## Positioning

A generic notes or journaling app can't truthfully claim this: Ponder runs a RAG pipeline over your entries (paragraph-level chunking, embeddings, LLM-extracted emotion/topic/entity metadata, hybrid vector + structured retrieval, HyDE query embedding, automatic filter extraction from the question itself) so a question like "what were the times I felt anxious about work this year?" returns a synthesized, citation-backed answer grounded only in your own real entries — never a fabricated or forced answer when nothing matches.

## Operating Context

Solo, asynchronous use: write entries over time, then periodically come back and query them. Auth is magic-link email (no password). A `/debug/chunks` and `/debug/search` pair of dev-only tools (gated behind `import.meta.env.DEV`, unreachable in production builds) exist for hand-checking pipeline output — not part of the product surface end users see.

## Capabilities and Constraints

- Markdown entries only; rich text, mobile/desktop clients, and offline sync are explicitly out of scope for v1 (per README).
- `src/data/` is framework-agnostic by design, intended for reuse by future Expo/Tauri clients — a durable architectural constraint, not a current product surface.
- Retrieval and synthesis both run through Supabase Edge Functions calling OpenAI (`text-embedding-3-small`, `gpt-4o-mini`); nothing about the design should imply real-time/instant answers — synthesis is a deliberate multi-step pipeline.
- "Nothing matched" is a real, expected outcome the UI must represent honestly, not paper over — the backend already distinguishes it from a zero-result search explicitly.

## Brand Commitments

None beyond the name "Ponder" itself. No existing visual identity, voice guide, or public-facing brand assets yet.

## Evidence on Hand

No real user content, testimonials, or case studies exist yet — this is the developer's own private journal, still early. Do not fabricate example entries, quotes, or usage stats; any sample content in design work must be clearly placeholder.

## Product Principles

1. Grounded over generative: answers must trace back to real entries via citations; the product must never look like it's guessing or fabricating insight about the user's life.
2. Private by default: strictly single-owner data, no sharing, comments, or public-entry affordances — this is a constraint on future scope, not just current behavior.
3. Descriptive, not diagnostic: the product reflects back what was written, never interprets it clinically or therapeutically — it is not framed as therapy or a diagnostic tool.
4. Journaling friction stays low: the core write path (markdown entry, save) should never be made heavier in service of the search/synthesis features built on top of it.

## Accessibility & Inclusion

No standard formally required yet; no known accessibility needs beyond ordinary web best practice.
