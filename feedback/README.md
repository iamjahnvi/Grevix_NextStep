# Challenge 2 — The Personalized Exam Discovery Buffer

> **Feedback folder:** how Team Grevix redesigned NextStep to handle stale exam data
> without misleading students.

## The situation (problem)

NextStep assumed eligibility criteria and registration dates scraped from
official websites and PDFs were always fresh. In reality, authorities update
late, re-upload PDFs under new URLs, or publish corrigenda — so NextStep could
tell a student "you are eligible / applications open" from outdated data and
cause a missed opportunity.

## The mission (what we built)

Redesign NextStep so **uncertain data can never mislead**, while **core
discovery keeps working exactly as before**:

| Mission requirement | Where it lives in this repo | Status |
|---|---|---|
| Caching with expiration / freshness tracking | `scraper/surveillance/` — `sourceSurveillance.js`, `allowlistFreshness.js`, `freshnessDashboard.js` | ✅ Implemented |
| Third-party / independent validation | Deterministic confidence ladder (`scraper/validators/confidence.js`) + human-operator adjudication (`PATCH /exams/:id/eligibility`) | ✅ Implemented |
| Balance accuracy vs false positives | Null-semantics rule: unknown ≠ eligible, unknown ≠ ineligible — unknown is **display-only, never filters** | ✅ Implemented |
| Core functionality unaffected | `GET /exams/recommend`, `GET /exams/discover`, `GET /exams/:id` unchanged in contract; scraper **never writes** to `exams` except via confirmed publish | ✅ Implemented + tested |
| Working prototype demo | Operator freshness dashboard (`GET /api/v1/scraper/freshness` + `client/src/pages/FreshnessDashboard.jsx`) and student "verify at source" CTA | ✅ Implemented |

## How to read this folder

1. **`CHALLENGE-2-implementation.md`** — the full detailed write-up: problem
   framing, architecture, every mechanism, the false-positive trade-off, and
   file-by-file code map. **Start here for evaluation.**
2. **`demo-guide.md`** — step-by-step script to run the prototype and
   demonstrate a delayed-update scenario end to end (student view + operator
   view).
3. **`README.md`** (this file) — index and one-page summary.

## One-page summary of our approach

We did **not** try to make scraped data "always correct" — that is impossible
when the source itself is late. Instead we built a **discovery buffer** around
the data with three layers:

1. **Never guess (data layer).** Every eligibility field is nullable.
   `null` means *"no confirmed value"* — the matcher in
   `server/utils/eligibility.js` **skips** null criteria instead of filtering
   on them, and the UI renders them as *"No criterion specified"*.
   Unknown is never converted into a requirement or a wildcard anywhere
   (`server/models/Exam.js:110-116`, `server/utils/eligibility.js:45-52`).

2. **Watch, don't overwrite (freshness layer).** The scraper works only on
   staging collections (`scraper_*`). Periodic surveillance re-fetches each
   source, hashes it (SHA-256), and compares it to a stored baseline:
   `NO_ACTION` (stable) → `REVIEW_REQUIRED` (changed — human must look) →
   `FAILED` (unreachable). Surveillance **never updates exam data, never
   accepts new content, never publishes** — it only says *"look again"* with
   both snapshots attached (`scraper/surveillance/sourceSurveillance.js:1-45`).

3. **Humans decide, machines record (validation layer).** Low-confidence or
   drifted fields go to operator review with a deterministic
   HIGH/MEDIUM/LOW/UNKNOWN grade. Only a `VERIFIED` draft can publish, only
   via an explicit `confirmPublish: true` gate, only as a **create**
   (never an overwrite — manual corrections are immortal).
   Operators can also patch production directly with a fully audited
   `PATCH /exams/:id/eligibility` (`server/services/examEligibilityService.js`).

Students keep discovering exams exactly as before (`/discover` works even with
an incomplete profile; `/recommend` stays eligibility-gated), but every exam
page carries a **"Visit official website ↗"** escape hatch so the student can
verify at the source before acting — the honest UX for inherently delayed data.

## Key files (quick map)

- Student path: `server/controllers/examController.js` (`recommendExams`,
  `discoverExams`, `enrichWithStatus`), `server/utils/eligibility.js`,
  `server/utils/discovery.js`, `client/src/pages/MainPage.jsx`,
  `client/src/pages/ExamDetails.jsx`
- Buffer path: `scraper/surveillance/*`, `scraper/validators/confidence.js`,
  `scraper/publish/publishExecutor.js`, `server/services/examEligibilityService.js`
- Operator path: `server/controllers/freshnessDashboardController.js`,
  `server/routes/freshnessDashboardRoutes.js`,
  `client/src/pages/FreshnessDashboard.jsx`
