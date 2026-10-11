# Demo Guide — Challenge-2 Prototype Walkthrough

**Audience:** hackathon evaluators / reviewers.
**Time:** ~10 minutes. **Prereqs:** repo cloned, `MONGO_URI` set (see `.env.example`), backend + frontend installed.

---

## 0. Start the system (2 min)

```bash
# Terminal 1 — backend (from repo root)
cd server && npm install && npm run dev
# → Next Step Backend is Running (default http://localhost:5000)

# Terminal 2 — frontend
cd client && npm install && npm run dev
# → Vite URL (default http://localhost:5173)
```

Backend health: `GET /` → `"Next Step Backend is Running"`;
`GET /api/v1` → `{ success: true, message: "Next Step API v1" }`.

Optional pre-flight (proves the buffer is intact without touching data):

```bash
cd scraper
node -e "require('./operations/verify').verifyDeployment({env: process.env}).then(r => console.log(JSON.stringify(r, null, 2)))"
# Expect passed: true — incl. step 10 "publish-boundary: dry-run default … present"
```

---

## 1. Student view — discovery still works (3 min)

1. Sign up / log in.
2. **Discover tab (no profile needed):** open MainPage → change Career Type /
   Exam Type / Month / Application Status → Search.
   - Network tab: `GET /api/v1/exams/discover?careerType=ENGINEERING…`
   - Response includes `personalized: false` + echo of `filters` — the UI
     labels these as *"matching your filters"*, never *"eligible for you"*.
3. Complete profile (education level + stream + percentage), then open
   **My Matches**: `GET /api/v1/exams/recommend` → only eligible exams,
   ordered Open (closing soonest) → Opening Soon → Closed.
4. Open any exam → **Exam Details** shows dates, status badge, eligibility
   (unknown renders as *"No … specified"* — never a guessed value), and the
   **"Visit official website ↗"** button. **Click it:** this is the
   verify-at-source escape hatch — the buffer's honest UX for delayed data.

**What this proves:** core functionality is unaffected; uncertainty is shown,
not hidden or guessed.

---

## 2. Delayed-update scenario — the buffer in action (4 min)

### Scenario A: authority moves the registration window late

1. As operator, note an exam's `registrationEndDate` in production.
2. Simulate the upstream change: run the surveillance check for its candidate
   (or edit the staging fixture / use a stubbed `fetchContent` that returns
   changed bytes — see `scraper/tests/sourceSurveillance.test.js` for the
   injectable pattern: `checkCandidateSource(id, deps, { fetchContent: stub })`).
3. Observe: outcome `REVIEW_REQUIRED`, review key `surveillance:<candidateId>`
   with trigger + **both snapshots** (previous hash vs current hash).
4. Open the operator dashboard: `GET /api/v1/scraper/freshness?status=REVIEW_REQUIRED`
   (or `/freshness` page) → candidate appears in **"Operator attention"** with
   reasons + history. **Production `exams` record is untouched** — students
   still see last confirmed dates + official-website link.
5. Operator verifies against the official site, then either:
   - publishes a new VERIFIED edition (explicit `confirmPublish: true`), or
   - patches production with audit: `PATCH /api/v1/exams/:id/eligibility`
     `{ "field": "eligibility.otherEligibility", "value": "…", "note": "verified vs official PDF dt. …" }`
     → record flips `origin` to `MIXED`, `manualEdits[]` gains an entry.

### Scenario B: bulletin PDF replaced under a new URL (redirect)

1. Run `checkAllowlistFreshness(candidateId, deps, …)` with a stubbed fetch
   returning a different `finalUrl`.
2. Observe per-URL result: `redirectDetected: true`, outcome `REVIEW_REQUIRED`,
   trigger `redirect-detected`, both URLs preserved. Configured URL is
   **never rewritten** — operator resolves via the allowlist declaration flow.

### Scenario C: CDN re-exports the same PDF (noise)

1. Same check with byte-identical content (same SHA-256) but different
   `byteLength` within the same size band → `NO_ACTION`. No operator spam.
   Change the band **and** the hash → `REVIEW_REQUIRED`. (See `sizeBand()` in
   `allowlistFreshness.js`.)

**What this proves:** delayed/rotated upstream data triggers *review work with
evidence*, never a silent student-facing lie and never a silent disappearance.

---

## 3. Talking points for evaluators (1 min)

- **"Where is the cache expiration?"** → There is no blind TTL. Freshness is
  *observed*: baseline hash → periodic re-probe → `NO_ACTION /
  REVIEW_REQUIRED / FAILED` with full history (`scraper/surveillance/`).
- **"Where is third-party validation?"** → Deterministic confidence ladder +
  human adjudication instead of another API to trust
  (`scraper/validators/confidence.js`, `PATCH /exams/:id/eligibility`).
- **"How did you handle false positives?"** → Null-means-unknown + skip (never
  filter) + display-only extended criteria + surveillance biased to false
  alarms while production matching stays strict.
- **"Did you break anything?"** → Endpoint contracts unchanged; scraper
  create-only publish; ~50 scraper test suites + server tests guard the
  boundaries (publish-never-overwrites, staging-model refusal, dashboard
  hardening).

## 4. Cleanup

- Surveillance dry-runs: pass `persist: false` (`{ dryRun: true }`, zero writes).
- Retention is manual-only (`confirm: true, actor`) — nothing auto-deletes.
- Demo stubs never touch production: surveillance asserts staging models and
  refuses `ExamModel`.
