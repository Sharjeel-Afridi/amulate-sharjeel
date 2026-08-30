# Adaptive question engine — product & technical blueprint

The thesis in one line: **the questionnaire is the product.** Anyone can rank
cars against a filled-in form; the moat is knowing *which five questions to ask
this particular customer* so the form barely needs filling in. Every section
below serves that: ask the minimum number of questions necessary to make the
best recommendation, and measure everything so the questions themselves get
better over time.

Target: something close to 90% recommendation acceptance with a short, simple,
enjoyable interaction. We optimise **accuracy × acceptance ÷ customer effort**,
never questions-answered.

## Where we already are

This is not a green-field plan. The repo already holds the walking skeleton,
and the discipline it encodes is exactly the discipline this product needs:

| Blueprint piece                  | Exists today                                             | Becomes |
| -------------------------------- | -------------------------------------------------------- | ------- |
| Question bank                    | `apps/api/src/questions.ts` — fixed, ordered plan        | Metadata-rich bank; order chosen per-turn by the engine |
| Customer profile                 | `Preferences` in `packages/shared/src/session.ts`        | `CustomerProfile` with source/strength/confidence per fact |
| Hard filters                     | `buildCriteria(prefs)` in `packages/shared/src/criteria.ts` | Unchanged idea: derived, never stored-and-edited |
| Weighted scoring + rationale     | `packages/ranking` (score, peers, rationale, verify)     | Same package, weights fed from the profile |
| Model/fallback boundary          | `flow/rank.ts` is the only place the model can fail      | Same rule, extended to extraction & explanation |
| Interview flow                   | `flow/` pipeline, one file per step                      | `flow/interview.ts` gains the ask-next loop |
| Surfaces                         | A2UI (agent-driven) + MCP Apps (transactional)           | Unchanged split |

The four rules in CLAUDE.md (criteria derived; one fallback point; drivers only
handle typed text; counts and money are ours) generalise into the design
principle of this whole plan: **the LLM supplies judgement and language; every
number, filter, ranking, and question-selection decision is deterministic code
we can log, test, and learn from.**

---

## 1. Product strategy

### What the product does

A customer lands, answers ~5–6 quick taps' worth of questions (dynamic — as
few as 3, capped at 8), and receives three cars: a best match, a meaningful
alternative, and an optional stretch/save option — each with an explanation
written in terms of *their own answers*. Booking/checkout completes in-flow.

### Core user journey

1. **Open** — one warm sentence, first question already on screen. No signup,
   no landing-page friction.
2. **Interview loop** — question → tap answer → *visible consequence* (the
   candidate pool shrinks on screen, a mini-shortlist reorders) → next
   question, chosen live.
3. **Recommendation** — the moment confidence clears the bar, stop asking and
   present the top 3 with reasons.
4. **React** — compare, reject-with-reason, tweak an answer (spec sheet stays
   editable), or accept.
5. **Transact** — book / reserve / enquire in-chat.
6. **Learn** — every step above is an event in the learning loop.

### Key differentiators

- **Adaptive, not linear.** Two customers share maybe two questions; the rest
  diverge based on their answers and on which cars are actually still in play.
- **Visible cause and effect.** Each answer visibly narrows or reorders the
  live pool. The customer *feels* the system listening — this is also what
  makes them keep answering.
- **Explanations grounded in their words.** "You said comfort, mileage and
  rear-seat space matter most — this gives you the strongest combination of
  the three inside your budget."
- **Stops early.** Ending at question 4 when confident is a feature customers
  can feel; competitors' 20-field forms cannot.

### Why the questionnaire becomes a moat

The moat is not the UI (copyable) or the car data (commodity). It is the
**question-performance dataset**: for each (customer-segment × candidate-set
state × question), how much did asking it improve the odds of an accepted
recommendation? That mapping only comes from running the loop at volume, and
it compounds — better questions → more completed sessions → more outcome data
→ better questions. A competitor starting later starts at zero. Requirement:
the event logging that feeds this dataset ships **in the MVP**, not after.

---

## 2. UX / UI

### Flow shape

One question per screen-state, card-stack style, in a conversational frame.
The A2UI surface split we already have carries over: the **stage** shows the
live candidate pool and shortlist; the **chat rail** carries the questions and
answers. Mobile-first: every control thumb-reachable, no hover-dependent UI.

### How each question appears

| Need                          | Control | Notes |
| ----------------------------- | ------- | ----- |
| One-of-few (fuel, gearbox)    | Chips   | Max ~5 visible; "no preference" always present |
| Pick-N priorities             | Multi-chips with counter ("pick 3") | The single highest-value soft-preference question |
| Budget, ranges                | Slider with live count ("27 cars in range") | Bounds always from real stock — never offer a range the catalogue can't fill (`questions.ts` already does this) |
| This-or-that trade-off        | Two large cards, tap one | Used for tie-breaking; can show two *actual cars* |
| Reaction to concrete options  | Swipeable car cards (keep / skip) | Doubles as observed-preference capture |
| Rare free text                | Short text with LLM parse + chip fallback | Only `useCase` and "anything else?"; everything else is taps |

Typing is a last resort. Where text is genuinely useful (use case, rejection
reason), the placeholder demonstrates that a fragment is enough ("school runs,
weekend trips"), and an LLM parse turns it into structured facts — with the
parsed chips shown back for one-tap confirmation, so the customer sees exactly
what we understood.

### Preventing questionnaire fatigue

- **Reward every answer.** The pool counter animates down ("142 → 38 cars"),
  and a peek-shortlist of 3 thumbnails reorders. Progress is shown as
  *narrowing*, not as a step count — a progress bar promises a fixed length
  we deliberately don't have. A soft "usually 5–6 quick questions" up front
  sets the expectation instead.
- **Every question earns its slot.** The engine literally will not ask a
  question that can't change the outcome (§3), which is the deepest
  anti-fatigue mechanism available.
- **Skippable always.** "Skip" is a first-class answer (and a signal: skipping
  luggage twice = low salience → drop that dimension's weight).
- **Interruptible.** The customer can type anything at any point ("actually
  max €25k") — the agent driver parses it, updates the profile, and the loop
  continues. Controls fire through the shared handler in `drivers/index.ts`,
  once, for both drivers, exactly as today.
- **Editable past.** The spec sheet (already built) stays one tap away; edits
  re-derive criteria and mark the session dirty rather than restarting.

### When to show recommendations

The instant the stopping rule fires (§3.6) — mid-flow if that's question 4.
Reveal #1 with its reasons first, alternatives a beat later, so the
explanation gets read. If the customer keeps engaging (rejects, compares), the
loop can resume with a differentiator question — recommendation is a state,
not a terminus.

### How AI interacts with the structured questions

The LLM *phrases* and *listens*; it never *chooses*. It renders the selected
question in context ("Since it's mostly motorway miles — how much luggage
usually rides along?"), parses free-text answers into profile facts, and
writes the explanation prose around deterministic numbers (counts and money
come from `flow/present.ts`, never the model — unchanged rule). If the LLM is
down, the raw question text and chips still work: the scripted driver is the
degradation path and it is fully functional.

---

## 3. Question engine

The heart of the product. Design goal: a **pure, deterministic, testable
function** — same engineering discipline as `packages/ranking` — that answers
"what is the most valuable piece of information I can get from this customer
right now?"

### 3.1 Question bank

Today's `QUESTIONS` array grows metadata and loses its implicit order:

```ts
interface QuestionDef {
  id: string
  ask: string                        // neutral phrasing; LLM may re-voice it
  control: 'chips' | 'multi' | 'slider' | 'cards' | 'tradeoff' | 'date' | 'text'
  options?: Option[]                 // static, or generated from candidate set
  targets: ProfileSlot[]             // which profile facts an answer writes
  kind: 'hard' | 'weight' | 'differentiator' | 'context'
  precondition?: (p: CustomerProfile) => boolean   // dependency gating
  appliesWhen?: (c: Candidate[]) => boolean        // pool-relevance gating
  answerModel: AnswerModel           // plausible answers + priors, for simulation
  cost: number                       // base friction: taps, reading, thought
  stats?: QuestionStats              // learned: ask-rate, drop-off, flip-rate…
}
```

Four kinds, because they earn their slot differently:

- **hard** — writes a filter (budget, seats, mode, dates). Value = candidates
  eliminated.
- **weight** — writes scoring weights (pick-3 priorities, comfort vs economy).
  Value = re-ranking movement.
- **differentiator** — *generated at runtime* from the attribute that best
  splits the current top cars ("These two are neck and neck — one is roomier,
  one is cheaper to run. Which wins?"). Value = tie broken.
- **context** — use case, current car, what it must improve. Value = seeds
  many inferred facts at once via extraction; asked early precisely because
  one cheap answer moves many slots.

### 3.2 Dependencies and branching

Two mechanisms, both declarative:

- `precondition(profile)` — hard gating. `returnDate` requires `mode = rent`;
  "what should the next car improve?" requires a current car to exist.
- **Redundancy priors** — a static matrix of question-pair mutual information,
  hand-set in v1, learned in Phase 2. City-usage answered ⇒ the parking
  question's expected gain is discounted because we can infer most of it.

There is no hand-drawn branch tree. Branching *emerges* from scoring: after
"mostly city driving", the parking/compactness/mileage questions score high
because they now slice the (city-suitable) pool hard; the highway-comfort
question scores near zero because the surviving candidates barely differ on
it. That is the difference between an adaptive engine and a flowchart, and
it's what makes the behaviour improve when the data improves.

### 3.3 Choosing the next question — expected outcome shift per unit cost

For every eligible question, simulate its plausible answers against the live
pool and measure how much the *outcome* would move:

```ts
function nextQuestion(profile, candidates, asked): QuestionDef | null {
  const eligible = bank.filter(q =>
    !asked.has(q.id)
    && (q.precondition?.(profile) ?? true)
    && poolVaries(q, candidates))          // never ask about an attribute
                                           // the remaining cars agree on
  const scored = eligible.map(q => ({
    q, value: expectedGain(q, profile, candidates) / frictionCost(q),
  }))
  const best = maxBy(scored, s => s.value)
  return best && best.value >= MIN_GAIN ? best.q : null   // null ⇒ stop
}

function expectedGain(q, profile, candidates): number {
  return sum(q.answerModel.answers.map(a => {
    const p     = answerPrior(q, a, profile)      // uniform in v1, learned later
    const next  = rankAll(applyAnswer(profile, q, a), candidates)
    return p * outcomeShift(candidates, next)
  }))
}
```

`outcomeShift` is a weighted mix of three observable effects:

| Component        | Measures                                   | Rewards |
| ---------------- | ------------------------------------------ | ------- |
| eliminationShare | fraction of pool removed by new filters    | hard questions |
| topFlip          | did the #1 car change?                     | decisive questions |
| marginDelta      | change in `P(top1) − P(top2)` (see §5.4)   | tie-breakers |

This is a tractable approximation of expected information gain over "which
car will this customer choose", using machinery we already have: `rankAll` is
`packages/ranking`, `applyAnswer` writes a scratch profile, everything is pure
and unit-testable. Cost is O(questions × answers × pool), pool ≤ a few
hundred — trivially fast, and cacheable per turn.

`answerPrior` starts uniform (with hand-set skews where obvious) and becomes
the empirical answer distribution per segment in Phase 2 — one of the first
places real data sharpens the engine without changing its shape.

### 3.4 Differentiator generation

When the score gap between #1 and #2 is small, a special candidate question is
synthesised rather than looked up: diff the two cars across scoring
dimensions, take the dimension with the largest normalised disagreement the
profile is still uncertain about, and render it as a two-card trade-off. Its
expected gain is computed the same way as every other question's — it enters
the same auction, it just usually wins it when the race is tight.

### 3.5 Question effectiveness (feeding §7)

Per question, per session, log: shown → answered/skipped/abandoned, time to
answer, pool delta, rank shift magnitude, whether #1 flipped, and — once the
session resolves — whether the session's recommendation was accepted. Rolled
up (per segment) these become `QuestionStats`, which feed back into
`frictionCost` (observed drop-off raises cost) and `answerPrior`. A question
that never changes outcomes and often gets skipped priced itself out of the
auction: dead questions retire themselves.

### 3.6 Stopping conditions

Stop asking and recommend when **all** of:

1. Required hard slots are filled (mode, budget, seats — the spec sheet's
   non-negotiables), and
2. any of:
   - **Confidence**: `P(top1) − P(top2) ≥ gap` (start: 0.15) — clearly ahead;
   - **Exhaustion**: best remaining `expectedGain < MIN_GAIN` — nothing left
     worth asking (this is the "if it won't change the ranking, don't ask it"
     rule, mechanised);
   - **Cap**: 8 questions asked;
   - **Tiny pool**: ≤ 3 candidates survive the filters.

Floor of 3 questions so a lucky early gap doesn't produce an unearned-feeling
recommendation. All four thresholds are config, and become *learned* stopping
policies in Phase 4 (stop when the marginal question's predicted acceptance
uplift < its predicted drop-off risk).

---

## 4. Customer profile

One structure behind the whole system. The existing flat `Preferences` stays
as a *projection* of it (so `buildCriteria`, the spec sheet, and the ranking
inputs keep working), but the source of truth becomes fact-level:

```ts
type Source   = 'stated' | 'inferred' | 'observed' | 'default'
type Strength = 'dealbreaker' | 'hard' | 'soft'

interface PreferenceFact<T = unknown> {
  slot: ProfileSlot          // 'budgetMax' | 'seatsMin' | 'weight.comfort' | …
  value: T
  source: Source
  strength: Strength
  confidence: number         // 0–1
  provenance: string         // question id, event id, or extraction id
  updatedAt: string
}

interface CustomerProfile {
  facts: Map<ProfileSlot, PreferenceFact>
  weights: Partial<Record<ScoreDimension, number>>   // comfort, economy, safety,
                                                     // space, performance,
                                                     // features, design, brand
  events: ObservedEvent[]    // append-only behaviour stream
  segment?: SegmentId        // derived: city-commuter, family-hauler, …
}

type ObservedEvent =
  | { kind: 'card_viewed' | 'card_skipped' | 'card_kept'; listingId: string; ms: number }
  | { kind: 'compared'; listingIds: string[] }
  | { kind: 'rejected_rec'; listingId: string; reason?: string }
  | { kind: 'question_skipped'; questionId: string }
  | { kind: 'spec_edited'; slot: ProfileSlot; from: unknown; to: unknown }
```

### The taxonomy the brief asks for, and how each is handled

| Notion            | Representation | Effect |
| ----------------- | -------------- | ------ |
| Stated preference | `source: 'stated'`, confidence 0.9+ | Filters & weights, verbatim |
| Inferred preference | `source: 'inferred'` (from use-case extraction, segment priors), confidence 0.4–0.7 | Weights only; never a hard filter; a targeted question can confirm → promote to stated |
| Observed behaviour | `events` folded into `inferred` facts by deterministic rules (kept 3 sporty cars ⇒ `weight.performance` ↑) | Weights; also flags contradictions |
| Hard constraint   | `strength: 'hard'` | `buildCriteria` filter; relaxable with consent when pool empties (the search step already reports relaxations honestly) |
| Deal-breaker      | `strength: 'dealbreaker'` | Filter that is *never* auto-relaxed. Kept as its own question — people are far more certain about what they'll reject (the insight already in `questions.ts`) |
| Soft preference   | `strength: 'soft'` | Scoring weight only |
| Confidence        | per-fact float | Low-confidence facts are what differentiator questions target; decays if contradicted |

### Stated vs observed — the conflict rule

Observed behaviour never silently overwrites a stated fact. It *lowers the
stated fact's confidence*, and when confidence drops below a threshold the
engine's auction naturally starts favouring a clarifying question ("You
mentioned economy, but the cars you're keeping are the quick ones — which way
should we lean?"). The customer stays in charge of their own profile; the
long-term stated-vs-chosen dataset this generates is precisely the learning
input Phase 3 needs.

---

## 5. Recommendation engine

Four stages, all deterministic, three of which exist today.

### 5.1 Hard filtering

`buildCriteria(profile→Preferences)` — pure, derived at point of use, exactly
as now. Budget, seats, transmission, fuel, mandatory features, deal-breakers.
Empty-pool handling stays honest: relax the softest hard constraint (never a
deal-breaker), and *say so* in the summary (`SearchSummary.relaxed`).

### 5.2 Weighted scoring

`packages/ranking` as-is, with one change: the dimension weights come from
`profile.weights` instead of fixed defaults. Score =
Σ (weightᵢ × normalised attribute scoreᵢ), per customer — so different
customers genuinely get different rankings, and the rationale generator can
say *which* weights drove the result because it can see them.

### 5.3 Emotional & behavioural fit

Not a separate magic pass — three concrete dimensions inside the same scorer,
so they stay explainable:

- **brand affinity**: prior from stated brand answers and the current car;
  adjusted by observed keeps/skips per brand.
- **design fit**: body-style and character tags (sporty, understated, rugged)
  matched against stated pick-3 choices and swipe behaviour.
- **continuity**: similarity to the current car on the dimensions the customer
  said they *liked*, distance from it on the ones they want *improved*.

### 5.4 Confidence

Convert scores to a choice probability with a softmax:
`P(carᵢ) = exp(scoreᵢ/T) / Σⱼ exp(scoreⱼ/T)`. Confidence = `P(top1)`; the
stopping margin = `P(top1) − P(top2)`. Temperature `T` is a constant in v1 and
gets **calibrated against real acceptance outcomes** in Phase 2 (when we say
80%, 80% should accept — the calibration curve in §8 keeps us honest).

### 5.5 Presentation — three, not twenty

- **#1 Best match** — highest P. Explanation names the customer's own top
  answers and connects them: "You told us comfort, mileage and rear-seat space
  matter most; within €X this has the strongest combination of the three."
- **#2 Best alternative** — not the runner-up score, but the highest-scoring
  car with a *different dominant trade-off* ("€60/month cheaper, one size
  smaller"). If #2 is just #1 with a different badge it teaches nothing and
  wins no trust.
- **#3 Optional stretch/save** — one budget step cheaper or more premium,
  shown only when the pool genuinely offers one.

Explanation prose may be LLM-voiced, but every number in it — counts, prices,
deltas — is computed in `flow/present.ts`. Unchanged rule, now with more
surface area.

---

## 6. AI / LLM architecture

The boundary, stated once and enforced everywhere (it is already this repo's
core discipline):

**LLM = language and judgement. Deterministic code = every decision that must
be repeatable, loggable, learnable, or adds up money.**

| Job | Owner | Notes |
| --- | ----- | ----- |
| Parse free text → profile facts | LLM, structured output | Each fact confirmed via chips; failure ⇒ show the chips, ask directly |
| Re-voice a question in context | LLM | Falls back to the bank's neutral `ask` |
| Explanation prose | LLM around deterministic numbers | `flow/present.ts` computes; model narrates |
| Rejection-reason understanding | LLM → structured reason codes | Feeds analytics |
| Off-script conversation ("is hybrid worth it?") | LLM (agent driver) | Answer, then return to the loop |
| Unusual replies ("depends on my dog") | LLM maps to nearest fact + flags for review | The long tail no chip set covers |
| Hard filtering | Code | never LLM |
| Scoring & ranking | Code (`packages/ranking`) | model may *re-order within the shortlist* as today, via `flow/rank.ts`, the single fallback point |
| Next-question selection | Code (§3) | later a *learned model*, still not an LLM at runtime |
| Stopping decision | Code | thresholds are config |
| Confidence, counts, money | Code | never LLM |
| Analytics | Code | never LLM |

Rationale beyond taste: the learning loop (§7) requires that identical inputs
produce identical decisions, or the logs can't attribute outcomes to causes.
An LLM choosing questions would poison the dataset the moat is made of.
Everything model-facing lives in `agents/`; the one place model failure is
handled remains `flow/rank.ts` plus a mirrored single fallback for extraction.

### Agent decomposition — detection vs interpretation

The agent layer follows the discipline in Gupta's *Definitive Guide to
Designing Effective Agentic AI Systems*: tools detect and execute the **what**
(deterministic, stateless, typed structured output, no decisions); agents
interpret the **so what** (judgement, ambiguity, user dialogue). When unsure
where a piece of logic belongs, apply the article's decision rule — *is this
recognising what objectively exists, or deciding what should be done about
it?* Detection goes in tools/packages; interpretation goes in an agent.

Rather than one monolithic "agent driver", `agents/` decomposes into four
single-responsibility agents, each with an explicit I/O contract:

| Agent | Role (article's taxonomy) | Contract | Fallback |
| ----- | ------------------------- | -------- | -------- |
| **Interviewer** | strategic / user interaction | Renders the question the engine selected, in context; handles off-script turns; never picks the question | Neutral `ask` text + raw chips |
| **Extractor** | interpretation → parameters | Free text in → typed `PreferenceFact[]` out. The article's hybrid pattern verbatim: *the agent determines parameters for deterministic tools* — it writes facts, never filters or ranks | Show chips, ask directly |
| **Explainer** | interpretation / transparency | Deterministic rationale + numbers from `flow/present.ts` in → prose out. May not introduce new claims or numbers | Template rationale from `packages/ranking` |
| **Ranker-critic** | validation / refinement | Shortlist in → reordering-within-shortlist or `undefined` out (today's `flow/rank.ts` contract, unchanged) | Deterministic order stands |

Orchestration is **task-driven, not agent-to-agent**: the `flow/` pipeline
(deterministic code) assigns each agent its task with exactly the context that
task needs; agents never call each other, and no agent holds session state —
state lives in the session store, tools stay stateless. This keeps every agent
independently replaceable and independently testable.

Validation is deterministic and sits *after* every agent output, in the
article's validation-agent slot but implemented as code (cheaper, and it must
be trustworthy when the model isn't): schema-check the Extractor's facts
against slot types and catalogue vocabulary; verify the Explainer's prose
quotes only supplied numbers (the `packages/ranking` verify pass already does
this for rationales); bound the Ranker-critic to reordering only. One retry on
validation failure, then the fallback column — a refinement loop with a depth
of one, because an unbounded refine loop is a latency and cost hazard in a
tap-speed UI.

Performance, per the article's optimisation guidance: tier the models (small
fast model for extraction and question re-voicing — routine, structured,
high-volume; the capable model only for explanation prose and off-script
conversation); cache re-voicings keyed on (question, profile-segment); pass
each agent the minimal structured context, never the transcript. The stopping
rule in §3.6 is the article's "early stopping when sufficient quality is
reached", applied to the interview itself.

Testing follows directly from the contracts: every agent is exercised with
canned structured inputs and golden outputs (feed the Extractor fixed
utterances, assert facts; feed the Explainer a fixed rationale, assert no
invented numbers) — no live model in CI, since every agent boundary is typed
and every deterministic component is a pure function.

---

## 7. Learning system

### 7.1 The episode log — the moat's raw material

One append-only record per session, written incrementally:

```ts
interface Episode {
  sessionId: string
  arm: 'adaptive' | 'static-filter'          // experiment assignment
  turns: Turn[]                              // per question asked:
  //   { questionId, candidatesConsidered,   // which Qs the auction scored
  //     chosenBy: { gain, cost, propensity },// why this one won — propensity
  //     answer, msToAnswer,                 //   logged from DAY ONE (§7.3)
  //     poolBefore, poolAfter,
  //     top3Before, top3After, top1Flipped,
  //     profileSnapshotHash }
  recommendation: { listingIds: [string, string, string?], pTop1: number,
                    marginTop2: number, questionsAsked: number, ms: number }
  outcome: 'accepted_1' | 'accepted_2' | 'accepted_3'
         | 'chose_other'                      // + which car
         | 'rejected'                         // + extracted reason codes
         | 'abandoned'                        // + at which turn
}
```

This single structure answers every question in the brief's feedback list:
what was asked, what was answered, how each answer moved the ranking, how many
questions it took, where they dropped off, what they finally chose, and
whether stated mileage-lovers actually pick the frugal car.

### 7.2 What the data improves, in order of difficulty

| Target | Method | Needs |
| ------ | ------ | ----- |
| Answer priors (`answerPrior`) | Empirical distributions per segment | hundreds of sessions |
| Friction costs | Observed answer-time & drop-off per question | hundreds |
| Question ordering | Uplift: acceptance when Q asked vs not, matched by segment — the randomness in near-tie auctions provides natural experiments | thousands, **with propensities** |
| Confidence calibration | Fit T so predicted P(accept) matches observed | thousands of resolved outcomes |
| Ranking weights | Learning-to-rank (start: logistic regression / GBDT on chosen-vs-shown pairs) | 5–10k resolved outcomes |
| Preference prediction | Predict profile slots from partial profiles (segment priors done properly) | 10k+ |
| Next-question policy | Contextual bandit over the auction's candidates: predicted acceptance-uplift replaces hand-mixed `outcomeShift` | 10k+ **with logged propensities** |
| Acceptance prediction | Session-level model: P(accept) from profile + pool state — becomes the stopping rule | large |

### 7.3 The one non-negotiable: log propensities now

Off-policy learning (evaluating "what if we'd asked Y instead of X" from
historical logs) requires knowing the probability with which the logging
policy chose X. The v1 engine is deterministic-ish, so we add small controlled
randomisation among near-tied questions (ε ≈ 0.1 across candidates within 10%
of the top gain) and **record the propensity in every turn record from day
one**. It costs nothing now; without it, Phases 2 and 4 need thousands of
fresh sessions that the logs could have provided for free.

---

## 8. Analytics

North star: **effort-adjusted acceptance** = acceptance rate ÷ mean questions
asked. It encodes the brief's core constraint in a single number that cannot
be gamed by either asking more questions or recommending recklessly early.

| Metric | Definition | Watch for |
| ------ | ---------- | --------- |
| Recommendation acceptance | accepted any of top-3 ÷ sessions reaching a rec | the headline; target path → 90% |
| Top-1 accuracy | final chosen car = our #1 ÷ sessions with any choice | the honest one — counts choices made outside our rec |
| Top-3 accuracy | chosen ∈ our top-3 | gap vs top-1 shows ranking (not retrieval) errors |
| Questions per session | mean + distribution | creeping upward = engine losing confidence discipline |
| Time to recommendation | median seconds | the felt cost |
| Question-level funnel | per Q: ask rate, answer time, skip rate, drop-off | any Q with high drop-off and low flip-rate gets retired |
| Flip rate per question | P(#1 changes \| Q answered) | the per-question value signal |
| Rejection reasons | coded distribution (too expensive, wrong size, brand, looks, …) | each maps to a fixable stage: filters, weights, or bank gaps |
| Chosen-vs-recommended diff | attribute deltas when they chose other | systematic bias detector (e.g. we overweight economy) |
| Calibration | predicted P(accept) buckets vs actual | confidence must mean something before it may stop the interview |
| Regret | rank of the chosen car in our final list | 0 is perfect; high regret = ranking problem, missing car = retrieval problem |
| Abandonment point | turn index of drop-offs | UX pain map |
| Segment cuts | all of the above × segment | "for this profile, Q X ≫ Q Y" — the moat, quantified |

Dashboards per experiment arm from day one, since the MVP *is* an A/B test
(§10).

---

## 9. Technical architecture

Keep the monorepo; the shape is already right. Additions in bold.

```
apps/
  web/                    React + Vite — chat, A2UI renderer, MCP Apps host
  api/                    Express + Agents SDK — flow, sessions, SSE
    src/flow/             criteria, search, rank, present, spec, booking
      interview.ts        ← the ask-next loop (calls question-engine)
    src/questions.ts      → becomes the metadata question bank (§3.1)
    src/agents/           provider, ranker, extraction, explanation
  mcp-marketplace/        listing tools + ui:// booking & checkout apps
packages/
  shared/                 types: profile, episode, events join Preferences
  catalog/                mock data now; later an inventory-sync adapter
  ranking/                scorer + rationale (weights become an input)
  question-engine/        ← pure: auction, gain simulation, stopping (§3)
  learning/               ← offline jobs: stats rollups, calibration, weight
                            fitting; nothing here runs in the request path
```

| Concern | Now (MVP) | Later |
| ------- | --------- | ----- |
| Frontend | as-is: A2UI surfaces for pool/shortlist/comparison; MCP Apps for booking/checkout — never a hand-written catalogue, never payment outside the iframe | unchanged split |
| Backend | Express, in-memory session store + SSE (exists) | sessions → Redis/Postgres when horizontal |
| Database | episodes & events as JSONL append + SQLite rollups | Postgres (sessions, episodes, events, question_stats, experiments); events also to a queue for the warehouse |
| Car data | `packages/catalog` deterministic mock | inventory service with nightly sync + real-time availability check at booking |
| Recommendation service | in-process call to `ranking` | stays in-process for a long time — it's µs of arithmetic; don't microservice it |
| Question engine | in-process `question-engine` | same code path even when scoring gains ML help — the model *scores*, the auction *decides* |
| LLM layer | `agents/` behind the provider interface; one fallback point per capability; four single-responsibility agents (§6) | provider-agnostic; model tiering (small for extraction/re-voicing, capable for explanation); cache re-voicings; batch extractions |
| Analytics | rollup script → dashboard page | warehouse + BI; nightly `learning/` jobs write back `QuestionStats` |
| Experimentation | session-hash arm assignment, config-driven thresholds, arm on every event | proper platform with sequential tests |
| ML | none at runtime | Phase 3+: models trained offline in `learning/`, shipped as artefacts the deterministic engine consumes (weights, priors, calibration T) |
| APIs | today's session/turn endpoints + `POST events`, `GET /admin/question-stats` | public API unchanged; admin surface grows |

The deployment story stays boring on purpose: one API process, one static web
bundle, one MCP server, a nightly batch job. Boring is what lets the question
dataset — the actual asset — accumulate uninterrupted.

---

## 10. MVP

**The MVP proves exactly one sentence:** *a small number of adaptively chosen
questions produces a measurably better recommendation than a traditional
filter/search experience.* Everything is judged by whether it serves that
proof.

### Build (order matters)

1. **Question bank with metadata** — the existing 12 questions re-declared per
   §3.1, plus the pick-3 priorities question and one runtime differentiator.
   ~15 questions total. No more.
2. **Profile facts layer** — `PreferenceFact` store projecting to the existing
   `Preferences` so `buildCriteria`, ranking, and the spec sheet don't change.
3. **Question engine v1** — the auction with hand-set `outcomeShift` mix,
   uniform answer priors, static redundancy matrix, stopping rule, ε-random
   tie-breaking **with propensity logging**.
4. **Weighted ranking hookup** — profile weights into `packages/ranking`;
   confidence via softmax.
5. **UI** — chips/slider/pick-3/trade-off controls on the existing A2UI
   surfaces; pool-narrowing counter; top-3 reveal with explanations.
6. **Episode + event logging** — the full §7.1 record. This is not
   infrastructure-later; it is the deliverable.
7. **The control arm** — a plain filter/search page over the same catalogue
   (facets + results grid). Ugly is fine; honest is mandatory. 50/50
   session-level split.
8. **LLM in exactly two places** — use-case extraction and explanation
   phrasing, each with a deterministic fallback.
9. **Analytics rollup** — a script and a plain page: acceptance, top-1/3,
   questions/session, time-to-rec, per-question funnel, per arm.

### Explicitly not building (yet)

- Any ML at runtime; any learned weights (Phase 2+)
- Accounts, returning-user memory, cross-session personalisation
- Real inventory, real payments (checkout stays visibly mocked), real-time pricing
- Segment models beyond 3–4 hand-defined segments
- LLM-driven open conversation as the primary flow (agent driver stays the
  enhancement, scripted the baseline)
- Admin UI for question authoring (edit the TS file)
- Mobile app; the web is responsive and that's it
- More than ~15 questions in the bank — bank breadth is Phase 2's job, once we
  can measure which questions earn their keep

### MVP success gates

- ≥ 200 resolved sessions per arm
- Adaptive arm beats control on effort-adjusted acceptance, and on top-3
  accuracy with the gap not explained by session length
- Median questions ≤ 6; abandonment before rec ≤ 25%
- Every resolved session has a complete, replayable episode record

---

## 11. Evolution roadmap

Each phase has an explicit **data gate** — what must be collected before the
next phase is allowed to start. Phases overlap in build time but not in
go-live order.

**Phase 1 — Rule-based adaptive recommendation** *(the MVP above)*
Hand-tuned auction, hand-set weights, softmax confidence, full logging with
propensities, A/B vs static filters.
*Gate to 2:* ~1,000 resolved episodes with outcomes; per-question funnel
populated; the MVP hypothesis confirmed.

**Phase 2 — Data-driven question optimisation**
Replace uniform answer priors with empirical per-segment distributions; set
friction costs from observed answer-times and drop-offs; retire or rewrite
dead questions; grow the bank (new questions enter at a conservative prior
and must earn ask-rate); calibrate softmax temperature so confidence is
honest; tune stopping thresholds per segment.
*Gate to 3:* 5–10k resolved episodes; calibration curve stable; question
uplift estimates with usable confidence intervals.

**Phase 3 — Machine-learning recommendation**
Learning-to-rank on chosen-vs-shown pairs (logistic regression → GBDT before
anything deep); per-segment weight priors as warm starts; stated-vs-observed
reconciliation learned instead of hand-ruled. Models trained offline, shipped
as artefacts; the runtime stays deterministic given the artefact.
*Gate to 4:* ranking model beats hand weights offline (AUC on held-out
choices) and online (top-1 accuracy, same effort); ≥ 10k episodes with
propensities spanning the question space.

**Phase 4 — Predictive next-question engine**
The auction's hand-mixed `outcomeShift` is replaced by a model predicting
each candidate question's acceptance uplift given (profile state, pool state)
— a contextual bandit trained off-policy on the propensity-logged turns, then
refined online. Learned stopping: stop when predicted marginal uplift <
predicted drop-off cost. This is the brief's target question — *which question
maximises the probability I predict the eventual choice* — answered with a
model.
*Gate to 5:* bandit beats rule auction on effort-adjusted acceptance in A/B;
exploration budget sustainable.

**Phase 5 — Fully personalised recommendation**
Returning-customer memory (with consent), profile priors from first-touch
context, cross-session learning, richer behavioural embeddings of cars and
customers, market-level effects (price trends, availability). The interview
for a returning customer might be two questions long — which is the product
promise fully kept.

---

## 12. Worked examples — three customers, three different interviews

All three start from the same first two questions (mode is structurally
required; use case is the highest-gain context question — one cheap answer
seeds many facts). They diverge from question 3 onward, driven by the auction.
Pool counts assume the current ~300-listing mock catalogue.

### Customer A — the city commuter

| # | Engine's reasoning (visible in logs, not to user) | Question & answer | Effect |
| - | --- | --- | --- |
| 1 | `mode` is a precondition for most of the bank | **Rent or buy?** → *Buy* | Pool 300 → 297 buyables; buy-side questions unlock |
| 2 | `useCase` seeds the most slots per unit cost | **What will you mainly use it for?** → *"commuting in the city, parking is a nightmare"* | LLM extracts: `usage=city` (stated 0.9), `parking-tight` (stated 0.9), infers `weight.economy↑, size-penalty` (0.6). Segment: city-commuter |
| 3 | Budget is an unfilled hard slot — highest eliminationShare of all candidates | **Max budget?** (slider, live count) → *€22,000* | Pool 297 → 84 |
| 4 | Auction: highway-comfort gain ≈ 0 (city stated); parking/compactness partly inferred already, so *discounted*; **pick-3 priorities** wins on marginDelta across the 84 | **What matters most? Pick 3** → *Mileage, Reliability, Easy parking* | Weights set stated; compact economical hatches surge; P(top1)=0.34, margin 0.06 — not enough |
| 5 | Two hatches nearly tied; biggest disagreement on a low-confidence dimension: gearbox (one automatic, one manual, €1.4k apart). Differentiator synthesised and wins the auction | **City traffic — worth €1,400 more for an automatic?** (two cards) → *Automatic* | `transmission=automatic` (hard, stated); manual rival drops. P(top1)=0.61, **margin 0.27 ≥ 0.15 → stop** |

**Stopped at 5.** #1 compact automatic hatch: "You said mileage, reliability
and easy parking matter most, and city driving made the automatic worth it —
this is the strongest mix of the four under €22k." #2: the manual rival,
"€1,400 cheaper if you'll live with the gearbox." #3: a hybrid one size up,
"stretch option: better economy still, €2.8k over budget." Never asked:
luggage, highway comfort, seats (inferred 4–5 was never challenged by the
pool), brand.

### Customer B — the family hauler

| # | Reasoning | Question & answer | Effect |
| - | --- | --- | --- |
| 1 | — | **Rent or buy?** → *Buy* | |
| 2 | — | **Mainly use it for?** → *"family of five, school runs, and we drive to the coast most holidays"* | Extracted: `seats≥5` (stated), `usage=mixed/highway` (stated), infers `weight.space↑, weight.comfort↑`, `luggage-heavy` (0.6). Segment: family-hauler |
| 3 | Seats already known — the seats question is **skipped** (gain 0: pool already filtered). Budget wins again | **Max budget?** → *€38,000* | Pool → 61 (5+ seats within budget) |
| 4 | City questions score ~0. Highway-relevant slots now score high; **luggage** beats pick-3 here because the 61 cars *disagree on boot volume more than on anything else* (poolVaries drives the auction, not the segment stereotype) | **How much are you usually carrying?** → *Pram, sports kit, big luggage* | `bootLitres≥460` hard; pool → 24; three-row SUVs and big estates lead |
| 5 | Pick-3 now top gain | **What matters most? Pick 3** → *Safety, Comfort, Space* | Two cars near-tied: 7-seat SUV vs large estate. Margin 0.04 |
| 6 | Differentiator: biggest uncertain disagreement = third row vs bigger boot | **Occasional 6th & 7th seat, or maximum boot every day?** (two cards) → *Need the extra seats sometimes* | SUV clears. P(top1)=0.58, **margin 0.22 → stop** |

**Stopped at 6.** Note the divergence: B was never asked about parking,
gearbox, or mileage tolerance — and A was never asked about luggage or
seating. Same engine, same bank, different interviews, because the *pool*
disagreed on different things.

### Customer C — the upgrader with a feel for it

| # | Reasoning | Question & answer | Effect |
| - | --- | --- | --- |
| 1 | — | **Rent or buy?** → *Buy* | |
| 2 | — | **Mainly use it for?** → *"replacing my Golf — mostly weekend drives, I want something that feels special this time"* | Extracted: current car (Golf), `weight.design↑, weight.performance↑` (inferred 0.7), `usage=leisure`. "Improve on current" slot opens |
| 3 | Current-car follow-up (precondition now met) scores highest: it writes several slots at once | **What should the next car do better than the Golf? Pick 2** → *More fun to drive, Better looking* | Continuity facts: keep Golf-like practicality (liked, inferred), maximise design+performance (stated). Coupés and hot hatches rise |
| 4 | Budget still unfilled → wins | **Max budget?** → *€45,000* | Pool → 47 |
| 5 | *Observed event*: on the live shortlist, C skims past two sensible fast estates and dwells on / keeps two coupés. Rule fires: `weight.practicality` confidence drops 0.7→0.45. The auction now ranks a **stated-vs-observed clarifier** above pick-3 | **Being honest — still need the back seats, or is this the fun one?** (two cards) → *It's the fun one* | Practicality demoted to soft-low (stated, 0.9). A 2-seater previously ruled out re-enters. P(top1)=0.55, margin 0.19 → **stop** |

**Stopped at 5, one of which the customer experienced as the system "getting
it".** #1 coupé: "You wanted the step up from the Golf in looks and fun, and
you told us the back seats can go — this is the most car-per-euro of that kind
under €45k." #2: hot hatch, "keeps the back seats and 90% of the grin." #3:
a premium-badge option €4k over budget, flagged as the stretch.

Three sessions, 5–6 questions each, **two questions shared across all three**
(mode, use case) — the rest chosen by elimination power, ranking movement, and
tie-breaking against each customer's live pool. That is the adaptivity the
brief demands, produced by one auction rather than three flowcharts.

---

## Closing constraint, restated

Every future decision — new question, new model, new UI flourish — gets tested
against one ratio: **did recommendation acceptance go up, or customer effort
go down, without the other getting worse?** The 90%-acceptance target is
reached by making the questions smarter, never by making the customer work
harder. The dataset that makes questions smarter starts accumulating the day
the MVP ships, propensities and all — which is why the logging is in the MVP's
build list at #6 and not in a "later" section.
