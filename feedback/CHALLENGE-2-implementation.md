# CHALLENGE-2 Implementation Report: The Personalized Exam Discovery Buffer

**Project:** NextStep — personalized exam discovery platform (React + Express + MongoDB + Node scraper pipeline)
**Challenge card:** The Personalized Exam Discovery Buffer
**Goal:** Handle delayed/inaccurate upstream updates so students are never misled, without breaking discovery.

---

## 1. Problem framing: why "just scrape faster" cannot work

The old assumption: *eligibility + registration dates on websites/PDFs are
real-time, so whatever we scraped is truth.*

Reality we designed for:

- Authorities publish late, re-upload PDFs under **new URLs**, or issue
  **corrigenda/revision markers** days after the original bulletin.
- A scraper that blindly overwrites production on every crawl converts an
  upstream delay into a **student-facing lie** ("eligible, apply now" when the
  window already moved).
- A scraper that blocks everything until "fully verified" converts the same
  delay into **missing opportunities** (exam hidden while waiting).

So the redesign goal is a **buffer**: students always see *something useful*,
but the system **never asserts what it cannot evidence**, and every
uncertainty is routed to a human instead of being silently resolved by code.

---

## 2. Architecture overview

```
                        ┌──────────────────────────────────────────────────┐
                        │              OFFICIAL SOURCES (untrusted)        │
                        │   exam websites · PDFs · bulletin/CDN URLs       │
                        └──────────────┬───────────────────┬───────────────┘
                                       │ crawl / re-probe  │ periodic
                                       ▼                   ▼
┌────────────────┐   ┌─────────────────────────────────────────────────────┐
│   STUDENT      │   │              SCRAPER (staging only)                 │
│   DISCOVERY    │   │  discovery → extraction → confidence → review →     │
│   (production  │   │  VERIFIED draft ──publish gate──▶ production Exam   │
│   `exams`      │   │                                                     │
│   collection)  │   │  surveillance (watch-only, never writes exam data)  │
└───────▲────────┘   └──────────────────────┬──────────────────────────────┘
        │  reads only                        │ creates only, never overwrites
        │                                    ▼
        │              ┌────────────────────────────────────────────────────┐
        │              │  OPERATOR SURFACE (read-only + audited writes)     │
        │              │  freshness dashboard · manual eligibility patch    │
        └──────────────┴────────────────────────────────────────────────────┘
```

Three hard invariants enforce the buffer:

1. **Staging/production separation.** The scraper reads/writes only
   `scraper_*` collections (`examCandidate`, `surveillanceState`,
   `reviewState`, `editionDraft`, `publishReceipt`, `rawDocument` …).
   The **only** bridge to the production `exams` collection is
   `scraper/publish/publishExecutor.js`, which **creates** exactly one Exam
   per stable identity (`examSlug:year:cycle`) and **refuses** any other
   target collection (`PRODUCTION_EXAM_COLLECTION = "exams"`,
   `publishExecutor.js:50-89`). Tests assert it can never overwrite an
   existing record — so a routine ingestion can never clobber a manual
   correction.
2. **Dry-run by default.** Every publish entry point is read-only unless the
   caller passes explicit `{ confirmPublish: true }`. The deployment verifier
   (`scraper/operations/verify.js`, step 10 "publish-boundary") probes that
   this gate is still intact on every deploy.
3. **Surveillance never publishes.** Both watchers state this in their headers
   and enforce it in code by **refusing production models**
   (`if (deps.ExamModel) throw … never publishes`).

---

## 3. Mechanism 1 — Caching with expiration, rebuilt as "observed freshness"

The mission suggests *"caching with expiration times"*. We implemented the
stricter, auditable version of that idea: **baseline + re-probe + explicit
outcomes**, instead of a silent TTL that would either serve stale data or hide
exams.

### 3a. Source surveillance (`scraper/surveillance/sourceSurveillance.js`)

For each ingested candidate source:

1. **First run establishes a baseline** — the fresh snapshot becomes the
   baseline with outcome `BASELINE`/`NO_ACTION` ("nothing to compare is not
   drift").
2. **Every later check:** load stored baseline → fetch current bytes →
   SHA-256 hash → compare with the existing Step-8 `compareForDrift`
   (transport signals: URL/hash/revision; content signals: excerpts/value via
   `options.observe`).
3. **Outcome is one of three states:**
   - `NO_ACTION` — stable, nothing to do.
   - `REVIEW_REQUIRED` — something meaningful changed; a Step-8 review state
     is recorded under key `surveillance:<candidateId>` with trigger, source,
     documents, and **both evidences** (old + new) so the operator compares.
   - `FAILED` — fetch failed; recorded, isolated per candidate (one
     candidate's failure never stops the rest in `runSurveillanceChecks`).

Snapshots stored: `{ sourceUrl, documentUrl, contentHash, revision,
evidenceExcerpts, value }`. Full bytes are never stored in freshness state —
the hash is the identity.

### 3b. Bulletin/allowlist freshness (`scraper/surveillance/allowlistFreshness.js`)

Official **bulletin URLs rot** (CDN rotation/replacement). Each adapter-declared
bulletin URL is re-probed through the render-aware transport and snapshotted
deterministically:

```
{ url, finalUrl, redirectDetected, reachable, accepted, documentType,
  contentType, byteLength, contentHash (SHA-256, PDFs), reason, observedAt }
```

Rules that matter for the challenge:

- **Redirect (`finalUrl !== declared`) is always `REVIEW_REQUIRED`** with both
  URLs preserved; the configured URL is **never rewritten** automatically.
- Previously reachable → now unreachable/invalid = `REVIEW_REQUIRED` (a
  meaningful change, never a silent drop).
- Hash/type/content-type/size-class change = `REVIEW_REQUIRED` via
  `compareForDrift`. Size compares by **magnitude band**
  (tiny <1KB / small <100KB / medium <1MB / large <10MB / huge) — and a band
  change only matters with a hash change — so CDN re-encoding noise alone does
  not page the operator.
- First observation establishes the baseline (`NO_ACTION +
  baselineEstablished`, or `FAILED` when the probe itself fails).
- Drift records **one Step-8 review item per changed URL**
  (`field: allowlist:<url>`, LOW confidence) under the shared
  `surveillance:<candidateId>` key. No competing review system.

### 3c. Freshness dashboard — the operator's expiration view

- Data layer: `scraper/surveillance/freshnessDashboard.js` (Step 25, read-only).
  `getFreshnessDashboard(filters, models, { resolveAdapter })` joins
  candidates + surveillance states + review states + allowlist declarations
  into per-candidate views with per-bulletin `declarationStatus`
  (active/retired/inactive/unknown), `freshnessStatus`
  (NO_ACTION/REVIEW_REQUIRED/FAILED), reasons, latest + baseline observations,
  history counts, linked reviews, and resolution history. It **refuses
  production models** (`assertStagingModels`).
- API: `GET /api/v1/scraper/freshness` (`server/routes/index.js:20`,
  `server/routes/freshnessDashboardRoutes.js`, `server/controllers/freshnessDashboardController.js`)
  with validated `candidateId / limit / status` filters. Auth-protected.
- UI: `client/src/pages/FreshnessDashboard.jsx` + `freshnessDashboardViewModel.js`
  — read-only operator view with summary metrics, "operator attention" list
  (REVIEW_REQUIRED/FAILED first), and per-bulletin observation history.

**How this answers "expiration":** nothing is served past an invisible TTL.
Instead, every source has a *visible* freshness state and history; stale or
moved sources surface as review work with evidence, while students keep seeing
the last **confirmed** production data plus a verify-at-source link ( §6 ).

### 3d. Retention keeps history auditable but bounded

`scraper/operations/retention.js`: raw documents, edition drafts, publish
receipts, candidates, and source profiles are **kept forever** (provenance).
Only surveillance/review history tails (keep newest 20) and old terminal
operation runs (>90 days) are prunable — and only via explicit
`applyRetention({ confirm: true, actor })` with an audit report. Deletion is
never automatic.

---

## 4. Mechanism 2 — Third-party / independent validation

The mission suggests *"a third-party data validation service"*. We implemented
it as two independent, non-colluding validators (deterministic rules + human
judgment), because an external API would just move the trust problem:

### 4a. Deterministic confidence ladder (`scraper/validators/confidence.js`)

`evaluateFieldConfidence({ status, evidence, sourcesCount, revision, conflict,
llmOnly })` grades every extracted field HIGH / MEDIUM / LOW / UNKNOWN by
explicit rules (same inputs → same grade, with reasons attached for audit):

- `UNKNOWN` — no usable evidence.
- `LOW` (capped, overrides everything) — conflicting values, **LLM-only
  provenance**, `NEEDS_VERIFICATION`, or preserved ambiguity. *A disputed or
  machine-suggested value is never strong, however it reads.*
- `HIGH` — extractor HIGH **plus** a strengthener (page number, section
  context, 2+ supporting sources, explicit revision/corrigendum evidence).
- `MEDIUM` — extractor MEDIUM, or HIGH without corroboration.

LLM output is deliberately **never authoritative**: LLM-only fields cap at LOW
and route to human review; the manual-correction service takes **no LLM input
at all**.

### 4b. Human adjudication + audited manual correction

- Staging review pipeline (`scraper/pipeline/reviewPipeline.js`, review
  decision/drift modules) gates drafts: only `VERIFIED` drafts are publishable
  (`scraper/publish/publishService.js` builds the payload, `publishValidator.js`
  re-validates, executor writes).
- Production correction without a dashboard:
  `PATCH /api/v1/exams/:id/eligibility` (`server/controllers/examController.js:updateExamEligibility`)
  backed by `server/services/examEligibilityService.js`. Exactly one operation
  per request (common-field fix or custom-criterion add/update/remove), fully
  validated (unknown fields/values rejected; `null` clears to "no confirmed
  value"), stamped `MANUAL` in a `manualEdits[]` audit trail
  (`{ field, source, updatedBy, note, updatedAt }`), flipping record `origin`
  to `MIXED`. Cross-field sanity (e.g. `maximumAge >= minimumAge`) is checked,
  never silently fixed.
- Schema provenance (`server/models/Exam.js`): `origin: SEED | SCRAPER |
  MANUAL | MIXED`, `manualEdits[]`, and structured `customEligibility[]`
  (`key/label/value/status/source/notes/updatedBy`, unique keys,
  `CONFIRMED | NEEDS_VERIFICATION | NOT_APPLICABLE`) so extended criteria are
  displayable and promotable — never free text inside matching logic.

---

## 5. The false-positive trade-off: how we balanced it

The mission explicitly asks to balance *"data accuracy vs false positives"*.
Our policy, enforced in code:

> **When evidence is missing or disputed, the system must neither claim
> eligibility (false positive → missed deadline) nor claim ineligibility
> (false negative → hidden opportunity). It must *withhold the claim* and show
> the exam with its uncertainty visible.**

Concretely:

1. **Null semantics (the core anti-false-positive rule).**
   `server/models/Exam.js:110-116`: `null` = "no confirmed value" and **must
   never be read as a requirement, wildcard, or empty set**.
   `server/utils/eligibility.js:45-52` (`hasUsableListRequirement`) + every
   matcher (`examMatchesStream`, `examMatchesEducation`,
   `examMatchesPercentage`, `examMatchesAge`, `userMatchesExamSubjects`):
   null/empty/unusable criteria are **skipped (pass)**, never filtered on.
   Extended fields (`nationality`, `domicile`, custom entries …) are
   **display-only** until wired in — they can never silently filter anyone out
   (`isEligibleForExam`, `eligibility.js:346-359`).
   Effect: an exam is only excluded for a rule somebody actually evidenced.
2. **Surveillance is biased toward false alarms, production is biased against
   them.** Any meaningful drift → `REVIEW_REQUIRED` (cheap: operator glances,
   confirms). Production matching stays strict (no guessing). This is the
   correct asymmetry: operator time is cheaper than a student's lost year.
3. **Urgency ordering without hiding.** `enrichWithStatus` +
   `compareByUrgency` (`examController.js:36-95`): Open (closing soonest) →
   Opening Soon → Closed (most recently closed first). Time-critical exams
   surface first, but closed/uncertain ones remain explorable.
4. **Single source of truth for dates.** `getApplicationStatus` inclusive
   boundaries (`start <= now <= end → OPEN_NOW`) in
   `server/utils/discovery.js:261-268`, mapped to frozen frontend strings
   (`Open / Opening Soon / Closed`) — endpoints cannot duplicate or drift date
   logic.

---

## 6. Core functionality is unaffected (and how students experience the buffer)

- `GET /exams/recommend` — unchanged contract `{ success, count, data[] }`
  with `status/openingIn/closingIn` enrichment; still requires a complete
  profile (`educationLevel + stream + percentage`; age/subjects accepted but
  never required).
- `GET /exams/discover` — **the buffer made visible as product behavior:**
  complete profile → eligibility first, then filters (`personalized: true`);
  incomplete profile → filters only, honestly labelled `personalized: false`
  so the frontend never presents filtered exams as "eligible for you".
  Invalid `careerType / examType / applicationStatus / month` values are
  rejected `400`, never silently accepted.
- `GET /exams/:id` — unchanged.
- Student UX safety nets: every exam detail page carries a **"Visit official
  website ↗"** CTA (`client/src/pages/ExamDetails.jsx:539-548`) — the honest
  escape hatch for delayed data ("verify at the source before you act") — and
  MainPage keeps Discover / My Matches / Saved / Tracker tabs working off the
  same endpoints (`client/src/pages/MainPage.jsx:runDiscover/runMatches`).
- Discovery taxonomy itself (`server/utils/discovery.js`, mirrored in
  `client/src/constants/discoveryOptions.js`): 19 career types + 12 exam types
  with legacy aliases, month derived from the registration window
  (`examOverlapsMonth`, no stored month field), status derived from the same
  two dates. No new rules were invented in matching — the refactor only fixed
  normalization (rank-ordered education, all-streams handling, subject overlap).

---

## 7. File-by-file code map (for evaluators)

| Layer | File | Role |
|---|---|---|
| Model | `server/models/Exam.js` | Nullable eligibility, `origin`, `manualEdits[]`, `customEligibility[]`, discovery enums |
| Matching | `server/utils/eligibility.js` | Pure matchers, null-skipping, DOB-derived age, completeness |
| Discovery vocab | `server/utils/discovery.js` | Career/exam taxonomies, `examOverlapsMonth`, `getApplicationStatus` |
| Endpoints | `server/controllers/examController.js` | `recommendExams`, `discoverExams`, `getExamById`, `updateExamEligibility`, status enrichment + urgency sort |
| Operator correction | `server/services/examEligibilityService.js` | Validated manual patch service, provenance stamping |
| Freshness API | `server/controllers/freshnessDashboardController.js`, `server/routes/freshnessDashboardRoutes.js`, `server/routes/index.js` | `GET /api/v1/scraper/freshness` |
| Watcher 1 | `scraper/surveillance/sourceSurveillance.js` | Content-hash drift checks, baseline, review-state integration |
| Watcher 2 | `scraper/surveillance/allowlistFreshness.js` | Bulletin-URL re-probe, redirect/size-band rules |
| Dashboard data | `scraper/surveillance/freshnessDashboard.js` | Read-only join of candidates/states/reviews/declarations |
| Confidence | `scraper/validators/confidence.js` | HIGH/MEDIUM/LOW/UNKNOWN ladder with caps |
| Publish gate | `scraper/publish/publishExecutor.js`, `publishService.js`, `publishValidator.js`, `examMapper.js` | VERIFIED-only, dry-run default, create-only, identity `examSlug:year:cycle` |
| Ops safety | `scraper/operations/verify.js`, `config.js`, `runGuard.js`, `retention.js`, `notifications.js`, `health.js`, `logger.js` | 10-step deploy verify, locks, retention, notifications |
| Student UI | `client/src/pages/MainPage.jsx`, `ExamDetails.jsx`, `Recommendations.jsx` | Discover/Matches, verify-at-source CTA |
| Operator UI | `client/src/pages/FreshnessDashboard.jsx`, `freshnessDashboardViewModel.js` | Read-only freshness view, attention queue |
| Tests | `scraper/tests/` (~50 suites: `sourceSurveillance`, `allowlistFreshness`, `freshnessDashboard*`, `publish*`, `reviewConfidence` …) + `server/tests` | Proof the buffer holds (incl. "publish never overwrites") |

---

## 8. What we deliberately did NOT do (and why)

- **No silent auto-overwrite of production from crawls.** Would convert
  upstream delays into student-facing falsehoods. Only VERIFIED creates.
- **No LLM-authoritative fields.** LLM proposes; deterministic rules + humans
  dispose. LLM-only caps at LOW.
- **No hidden TTL expiry that hides exams.** Expiration is *observed and
  shown* (freshness states + history), not a cache that silently drops
  opportunities.
- **No guessing UNKNOWN into a value.** Null stays null from extraction
  through matching to UI ("No X specified"). This is the single decision that
  kills the most dangerous false positives.
