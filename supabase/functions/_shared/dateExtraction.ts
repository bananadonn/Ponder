import * as chrono from 'https://esm.sh/chrono-node@2'
import {
  startOfDay,
  endOfDay,
  subDays,
  startOfWeek,
  endOfWeek,
  subWeeks,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  subYears,
} from 'https://esm.sh/date-fns@4'

// date-fns' start/end-of-* helpers read the Date via local getters
// (getFullYear/getMonth/...), not UTC ones. Supabase Edge Functions (Deno
// Deploy) run with the process timezone set to UTC, so "local" and UTC
// agree here — this only matters if that ever changes.
const WEEK_OPTS = { weekStartsOn: 1 as const } // Monday–Sunday, not date-fns' US-default Sunday–Saturday.

export type DateFilter =
  | { type: 'range'; start: Date; end: Date }
  | { type: 'recurring_month'; month: number } // 1-12, matches every year

export type DateResolvedBy = 'calendar-unit' | 'chrono'

export interface DateExtractionResult {
  filter: DateFilter | null
  resolvedBy: DateResolvedBy | null
  // The pattern that won (name of the largest match, 'recurring_month',
  // 'month_year', or 'chrono_fallback'), and every pattern that matched —
  // logged so the largest-wins tradeoff (see below) can be spot-checked
  // against real questions over time.
  matchedPattern: string | null
  allMatchedPatterns: string[]
}

interface RangeMatch {
  name: string
  start: Date
  end: Date
  rangeSizeInDays: number
}

function rangeSizeInDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function toRangeMatch(name: string, start: Date, end: Date): RangeMatch {
  return { name, start, end, rangeSizeInDays: rangeSizeInDays(start, end) }
}

const LAST_YEAR_RE = /\blast year\b/i
const THIS_YEAR_RE = /\bthis year\b/i
const BARE_YEAR_RE = /\b(19|20)\d{2}\b/
const PAST_MONTHS_RE = /\b(?:past|last)\s+(\d+|a few|few|a couple(?: of)?|couple(?: of)?)\s+months?\b/i

// Calendar-unit patterns, checked independently — every one of these that
// matches the question gets collected, and (per extractDateFilter below)
// the LARGEST resulting range wins. We deliberately don't try to compose
// separate modifiers together (e.g. "last year" + "in may" isn't merged
// into a specific month). Prior testing showed that composing modifiers
// correctly is a much harder problem with disproportionate edge cases for
// a personal journaling app — taking the largest match is safe because
// it's over-inclusive, not under-inclusive: the true answer is contained
// within it, and topic/emotion/entity/vector signals narrow further from
// there. Month names are the one exception, handled separately below,
// because dropping either the month or an explicit year loses real signal
// the user gave directly.
type PatternMatcher = (question: string, now: Date) => RangeMatch | null

function matchToday(question: string, now: Date): RangeMatch | null {
  if (!/\btoday\b/i.test(question)) return null
  return toRangeMatch('today', startOfDay(now), endOfDay(now))
}

function matchYesterday(question: string, now: Date): RangeMatch | null {
  if (!/\byesterday\b/i.test(question)) return null
  const d = subDays(now, 1)
  return toRangeMatch('yesterday', startOfDay(d), endOfDay(d))
}

function matchThisWeek(question: string, now: Date): RangeMatch | null {
  if (!/\bthis week\b/i.test(question)) return null
  return toRangeMatch('this_week', startOfWeek(now, WEEK_OPTS), endOfWeek(now, WEEK_OPTS))
}

function matchLastWeek(question: string, now: Date): RangeMatch | null {
  if (!/\blast week\b/i.test(question)) return null
  const d = subWeeks(now, 1)
  return toRangeMatch('last_week', startOfWeek(d, WEEK_OPTS), endOfWeek(d, WEEK_OPTS))
}

function matchThisMonth(question: string, now: Date): RangeMatch | null {
  if (!/\bthis month\b/i.test(question)) return null
  return toRangeMatch('this_month', startOfMonth(now), endOfMonth(now))
}

function matchLastMonth(question: string, now: Date): RangeMatch | null {
  if (!/\blast month\b/i.test(question)) return null
  const d = subMonths(now, 1)
  return toRangeMatch('last_month', startOfMonth(d), endOfMonth(d))
}

function matchThisYear(question: string, now: Date): RangeMatch | null {
  if (!THIS_YEAR_RE.test(question)) return null
  return toRangeMatch('this_year', startOfYear(now), endOfYear(now))
}

function matchLastYear(question: string, now: Date): RangeMatch | null {
  if (!LAST_YEAR_RE.test(question)) return null
  const d = subYears(now, 1)
  return toRangeMatch('last_year', startOfYear(d), endOfYear(d))
}

// "past 3 months" / "the past few months" / "last couple of months" — an
// open span from N months ago through today, distinct from "last month"
// (a single closed calendar month). "few" and "couple" are the only vague
// quantifiers handled; anything else numeric-free falls through unmatched.
function matchPastMonths(question: string, now: Date): RangeMatch | null {
  const m = question.match(PAST_MONTHS_RE)
  if (!m) return null
  const raw = m[1].toLowerCase()
  const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : raw.includes('couple') ? 2 : 3
  return toRangeMatch(`past_${n}_months`, startOfMonth(subMonths(now, n)), endOfMonth(now))
}

function matchBareYear(question: string, now: Date): RangeMatch | null {
  const m = question.match(BARE_YEAR_RE)
  if (!m) return null
  const anchor = new Date(now)
  anchor.setFullYear(parseInt(m[0], 10))
  return toRangeMatch('bare_year', startOfYear(anchor), endOfYear(anchor))
}

const RANGE_PATTERNS: PatternMatcher[] = [
  matchToday,
  matchYesterday,
  matchThisWeek,
  matchLastWeek,
  matchThisMonth,
  matchLastMonth,
  matchThisYear,
  matchLastYear,
  matchPastMonths,
  matchBareYear,
]

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const MONTH_NAME_RE = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b`, 'i')

// Bare month name, e.g. "how did I feel in may" — no year given, so this
// means "every May, regardless of year", a recurring filter rather than a
// single range. Note: "may" collides with the modal verb ("I may go") —
// not disambiguated here, a known false-positive risk left as-is rather
// than special-cased, in keeping with the "don't over-fit individual
// phrases" spirit of this function.
function detectMonth(question: string): number | null {
  const m = question.match(MONTH_NAME_RE)
  if (!m) return null
  return MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1
}

// An explicit year signal accompanying a month name ("last year in may",
// "may 2025") means the user gave both pieces of information on purpose —
// unlike the no-composition rule above, discarding either here would lose
// real signal, so this is the one deliberate exception: month + year
// compose into a specific range instead of the recurring interpretation.
function detectYearSignal(question: string, now: Date): number | null {
  const bareYear = question.match(BARE_YEAR_RE)
  if (bareYear) return parseInt(bareYear[0], 10)
  if (LAST_YEAR_RE.test(question)) return now.getFullYear() - 1
  if (THIS_YEAR_RE.test(question)) return now.getFullYear()
  return null
}

function monthYearRange(month: number, year: number): { start: Date; end: Date } {
  const anchor = new Date(year, month - 1, 1)
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) }
}

// Minimal structural type for what we use off chrono's ParsedComponents —
// avoids depending on chrono's own exported types resolving cleanly through
// esm.sh.
interface Certainty {
  isCertain(unit: string): boolean
}

// Fallback for anything none of the calendar-unit patterns above catch
// (specific dates, "since Christmas" [no match — chrono's core parser has
// no holiday vocabulary], etc). chrono resolves an expression to one
// anchor Date plus per-field certainty, not a range — "day certain" means
// a specific day; "month certain but day not" means a bare month; "year
// certain but month not" means a bare year. We expand the anchor to the
// narrowest span its certainty implies. This is a coarser fallback than
// the calendar-unit patterns above (e.g. it still resolves "last week" to
// a single day, since chrono has no week grain) — that's fine, since
// real-world "last week" phrasing is already caught by matchLastWeek before
// this ever runs.
function chronoFallback(question: string, now: Date): DateFilter | null {
  const results = chrono.parse(question, now, { forwardDate: false })
  if (results.length === 0) return null

  const [result] = results
  const start = granularRange(result.start, result.start.date())
  if (!result.end) return { type: 'range', ...start }

  const end = granularRange(result.end, result.end.date())
  return { type: 'range', start: start.start, end: end.end }
}

function granularRange(component: Certainty, date: Date): { start: Date; end: Date } {
  if (component.isCertain('day')) return { start: startOfDay(date), end: endOfDay(date) }
  if (component.isCertain('month')) return { start: startOfMonth(date), end: endOfMonth(date) }
  if (component.isCertain('year')) return { start: startOfYear(date), end: endOfYear(date) }
  return { start: startOfDay(date), end: endOfDay(date) }
}

/**
 * Date-filter extraction: an independent field in query extraction (see
 * queryExtraction.ts), resolved deterministically rather than by the
 * keyword/LLM layers used for emotion/topics/entities.
 *
 * Order of resolution:
 *  1. A month name in the question ("in may") is handled first, as its own
 *     special case — with an accompanying year signal it composes into a
 *     specific month+year range; without one it's a recurring "every May"
 *     filter. Either way this short-circuits everything below it, so a
 *     coincidentally-matching pattern elsewhere in the sentence (e.g. "in
 *     may last week") can't outrank it via the largest-wins step.
 *  2. Otherwise, every calendar-unit pattern (today/this-week/last-month/
 *     .../bare year) is checked — not first-match-wins — and the one
 *     producing the LARGEST range wins. Over-inclusive beats under-
 *     inclusive here: the correct, narrower answer is contained within the
 *     larger range, and other retrieval signals narrow further from there.
 *  3. If nothing above matched, chrono-node parses the raw text as a last
 *     resort (specific dates, and anything else with no dedicated pattern).
 *  4. If chrono also finds nothing, the field resolves to null.
 *
 * `referenceDate` anchors relative expressions — pass the real current
 * time at query time, not a fixed date.
 */
export function extractDateFilter(question: string, referenceDate: Date): DateExtractionResult {
  const month = detectMonth(question)
  if (month !== null) {
    const year = detectYearSignal(question, referenceDate)
    if (year !== null) {
      const { start, end } = monthYearRange(month, year)
      return { filter: { type: 'range', start, end }, resolvedBy: 'calendar-unit', matchedPattern: 'month_year', allMatchedPatterns: ['month_year'] }
    }
    return {
      filter: { type: 'recurring_month', month },
      resolvedBy: 'calendar-unit',
      matchedPattern: 'recurring_month',
      allMatchedPatterns: ['recurring_month'],
    }
  }

  const matches = RANGE_PATTERNS.map((match) => match(question, referenceDate)).filter(
    (m): m is RangeMatch => m !== null,
  )
  if (matches.length > 0) {
    const largest = matches.reduce((a, b) => (b.rangeSizeInDays > a.rangeSizeInDays ? b : a))
    return {
      filter: { type: 'range', start: largest.start, end: largest.end },
      resolvedBy: 'calendar-unit',
      matchedPattern: largest.name,
      allMatchedPatterns: matches.map((m) => m.name),
    }
  }

  const fallback = chronoFallback(question, referenceDate)
  return {
    filter: fallback,
    resolvedBy: fallback ? 'chrono' : null,
    matchedPattern: fallback ? 'chrono_fallback' : null,
    allMatchedPatterns: fallback ? ['chrono_fallback'] : [],
  }
}
