# Level 6 — Goldfields Mastery: design blueprint and consideration register

> **Status: PLANNING ONLY.** No playable Level 6 exists.
> - The repository recognises Level 6 as `status: 'planned'` in `shared/level-capabilities.js`. It is disabled in the home page and the teacher UI, cannot be unlocked or routed to, and cannot be assigned. `tests/per-level-architecture.test.js` covers this.
> - Nothing below is implemented unless explicitly marked.
> - This register records what the product owner said in this request. It does **not** claim access to earlier chat sessions; "earlier ideas" means ideas restated in this request.
>
> Back to: [future-state architecture](future-state-architecture.md) · [flow registry](../power-automate/flow-registry-and-contracts.md)

## Register legend

| Tag | Meaning |
| --- | --- |
| **CONFIRMED** | Decided by the product owner in this request |
| **EARLIER IDEA** | Restated from earlier discussion; still needs a decision |
| **PROPOSAL** | Suggested here; optional |
| **OPEN** | Unresolved question |
| **DEPENDENCY** | Must exist first |
| **RESEARCH TODO** | Needs authoritative sources; do not ship unsourced |

## 1. Intent

- **CONFIRMED:** Level 6 "Goldfields Mastery" is a **historical timeline simulation**. It culminates the course in history, economics, probability, statistics, expected value, risk, investment and decision-making. It is **not** just a harder Level 5.
- **CONFIRMED:** It keeps the same core save identity, `ProgressKey = CLASS|STUDENT|6`, using the existing per-level envelope. Versioned extensions go inside the snapshot:
  - `currentEra`
  - `timelinePosition`
  - `historicalEventLog`
  - `decisionHistory`
  - `eraAchievements`
  - `masteryScore` + `scoringVersion`
  - `contentVersion`
  - RNG seed/state, if seeded randomness is adopted
- **CONFIRMED:** List index columns are added only if they are actually queried, for example `CurrentEra` or `ScoringVersion` for teacher filters.
- **CONFIRMED:** Gameplay stays unavailable until it is complete and deployed. There is no dummy playable Level 6.
- **CONFIRMED:** The Level 5 → 6 unlock is capped at the highest *enabled, deployed* level. Current behaviour is preserved until teacher policy and the backend are ready.

## 2. Era continuum

**EARLIER IDEA / RESEARCH TODO.** The product owner's era list is below. **The order and every date must be validated against authoritative sources before use.**

- An earlier sample placed the water pipeline *before* Federation. That ordering is **not** adopted as validated chronology.
- No dates are given here, deliberately: they must not come from model memory.

| # (proposed order, unvalidated) | Era working title | Date range | Source(s) | Reviewer sign-off |
| --- | --- | --- | --- | --- |
| ? | Southern Cross | RESEARCH TODO | TODO | ☐ |
| ? | Coolgardie | RESEARCH TODO | TODO | ☐ |
| ? | Kalgoorlie | RESEARCH TODO | TODO | ☐ |
| ? | Federation | RESEARCH TODO | TODO | ☐ |
| ? | Goldfields water supply scheme (pipeline) | RESEARCH TODO — **do not assume** order relative to Federation | TODO | ☐ |
| ? | Depression | RESEARCH TODO | TODO | ☐ |
| ? | Post-war | RESEARCH TODO | TODO | ☐ |
| ? | Modern mining | RESEARCH TODO | TODO | ☐ |

**PROPOSAL:** candidate authoritative source *types* to consult:
- State Library of Western Australia;
- State Records Office of WA;
- National Archives of Australia;
- Heritage Council of WA listings;
- Water Corporation / National Trust material on the water supply scheme;
- Australian Bureau of Statistics historical series;
- the Reserve Bank of Australia (pre-decimal currency and inflation);
- peer-reviewed economic history.

Each fact used in-game records its citation in the content files.

### Cultural and historical review (DEPENDENCY, CONFIRMED as required)

- **Traditional Owners and Country.** The goldfields are on Aboriginal Country. Content about land, water, labour and the effects of mining needs **consultation with the relevant Traditional Owner groups and Aboriginal education advisers.** It must also go through the school's cultural review process before release.
  - Do not stereotype.
  - Do not invent first-person Aboriginal perspectives.
  - Do not reduce people to "events".
  - Names of groups and places need verified sources and consultation.
- **Consequences to treat without invented probabilities:** water scarcity and health, labour conditions, transport, ore grade, and resource depletion. Probabilities or severity numbers for real historical harms must **not** be fabricated. Where a game mechanic needs a number, label it a *game abstraction* and keep it separate from historical claims.
- **Historian / curriculum review** before content lock. Record the reviewer and the date in the content manifest.

## 3. Simulation design

- **Fixed anchors vs simulated decisions (PROPOSAL):**
  - Historical anchors (era transitions, infrastructure arrival, price regimes) are *fixed, sourced content*.
  - Student choices (where to dig, what to buy, risk level, sustainability practices) are *simulated*.
  - The UI must make clear which is which.
- **Rounds ↔ dates (OPEN):** either a fixed number of rounds per era, or a variable mapping. Rounds must map to a timeline position so that saves record `currentEra` and `timelinePosition`.
- **Era transitions (PROPOSAL):** a transition is triggered by the timeline position, not by player wealth. Possible transition effects:
  - technology obsolescence (equipment depreciates or becomes unavailable);
  - new options unlock (e.g. after water or transport infrastructure arrives — **only** if sourced).
- **Information available at the time (PROPOSAL):** decisions are presented using information a contemporary could have had. Hindsight is not rewarded, and the end-of-game reflection compares the student's choices with the historical outcome.
- **Units and currency (RESEARCH TODO):**
  - pre-decimal £sd vs the decimal dollar;
  - nominal vs real prices;
  - inflation adjustment and its source series.
  - **OPEN:** whether to show both, and how to compare scores across eras. A real (inflation-adjusted) metric is needed before cross-era profit comparisons mean anything.
- **Geography (PROPOSAL):** the existing mine names (Southern Cross, Coolgardie, Kalgoorlie, Leonora, Laverton in `game-config.json`) could anchor places. Distances and transport costs need sources.

## 4. Mathematics content (grounded in the real configured rules)

The current Levels 2–5 dig rules in `shared/game-config.json` use the sum of 2d6, with these base multipliers:
- **safe:** success on 2–6, ×0.1 profit, break-even on failure;
- **medium:** success on 7–10, ×0.5 profit, lose the investment on failure;
- **deep:** success on 11–12, ×3.0 profit, lose the investment on failure.

Per-mine `deepVeinMultiplier` values (Leonora 5, Laverton 6), upgrades (silver: medium ×1.0; gold: deep ×4; platinum: deep ×8), machinery bonus, and d6 random events (including `automatic_success` and halve/double profit) all modify these.

The probabilities below are **exact maths for fair dice**. They are not historical odds and not invented.

| Dig | P(success) | Net payoff per $1 invested (base config, no bonus or events) | Expected net payoff per $1 |
| --- | --- | --- | --- |
| safe | 15/36 | +0.10 on success; 0 otherwise | +0.10 × 15/36 ≈ **+0.042** |
| medium | 18/36 | +0.50 on success; −1 otherwise | 0.5×18/36 − 18/36 = **−0.25** |
| deep | 3/36 | +3.0 on success; −1 otherwise | 3×3/36 − 33/36 ≈ **−0.667** |

Teaching points (PROPOSAL):

- **Expected value vs payout.** "Deep pays ×3" is a *payout*. The expected *net* payoff at base config is negative. Break-even needs multiplier × 3/36 = 33/36, i.e. a multiplier of 11 before bonuses.
  - With machinery bonus *b*, a success pays m×(1+b), so break-even is m(1+b) = 11.
  - For medium, break-even is m(1+b) = 1 (the silver upgrade's ×1.0 makes medium EV exactly 0 without bonus).
  - Students should derive these from the live config rather than memorise them. The content must compute them from the config so the numbers stay correct.
- **Variance and sample size:** few rounds means luck dominates. Use simulation or repeated trials to show convergence; discuss streaks.
- **Risk and risk-adjusted return:** the dispersion of outcomes, not just the mean. Consider drawdown and the risk of ruin when cash is low.
- **ROI and capital:** ROI = (end − start)/start for the run baseline. Adjust for capital injections if they are ever introduced. Opportunity cost and compounding apply across rounds.
- **Sustainability:** resource depletion and ore-grade decline as a modelled game abstraction, clearly labelled.
- **Historical data quality:** the gaps, biases and survivorship in historical records, and what they mean for any "historical odds".
- **Never invent exact historical odds as verified.**

## 5. Mastery score

- **CONFIRMED:** the preferred Level 6 ranking metric is a `masteryScore`.
- **EARLIER IDEA (tentative weights, NOT fixed):** 30% ROI / 30% risk-adjusted return / 20% historical reasoning / 20% sustainability.
- **Prerequisites before fixing the weights (OPEN / DEPENDENCY):**
  1. **Normalisation.** Define each component's scale (e.g. 0–100) and the method: percentile within cohort, fixed bands, or logistic. Document the edge cases: zero or negative baseline (ROI undefined → component unrankable, never coerced), zero variance (the risk-adjusted ratio is undefined), very short runs.
  2. **Explainable components.** Show each component separately to the student and the teacher. A single opaque number is not enough.
  3. **Historical reasoning.** Score reasoning with information available at the time (e.g. justified choices, quiz/reflection evidence), not hindsight outcomes.
  4. **Probability decision quality.** Reward choices with good expected value given the stated odds, separate from realised luck.
  5. **Sustainability and learning evidence.** Define observable criteria.
  6. **Validation and calibration.** Pilot with a teacher, check the score against teacher judgement, and adjust before a competitive release.
  7. **Anti-gaming.**
     - Seeded randomness with the RNG position saved, so reloading cannot re-roll.
     - Server recomputation; a client-asserted score is never authoritative.
     - Restart policy, e.g. a teacher-approved reset only for competitions.
     - Score caps on degenerate strategies.
- **Versioning:** `scoringVersion` and `contentVersion` are stored per save. Cohorts are compared only within the same version.

## 6. Competition, randomness and restarts

- **PROPOSAL:** seeded, reproducible competition randomness (a per-competition seed plus a per-student stream). The RNG state is saved in the snapshot so a reload cannot exploit it.
- **DEPENDENCY:** the competition context (architecture §9). The per-level key cannot hold a main game and a competition game at once.
- **OPEN:** baseline (start cash per era?), restart policy, timeline length, and teacher controls (pause, era lock, reveal answers).

## 7. Accessibility and presentation

- **PROPOSAL:**
  - an accessible timeline, with keyboard navigation and screen-reader text alternatives;
  - charts with a data-table equivalent;
  - a text event log;
  - colour-independent encodings;
  - reduced-motion support.
- **Curriculum mapping (RESEARCH TODO):** map to the relevant Australian / WA curriculum content descriptions for history, economics and mathematics (probability and statistics). Define the completion assessment, e.g. a reflection plus a quiz.
- **Content licensing:** record image and text licences and citations; review before release.

## 8. Flows, data and telemetry

**PLANNED**, gated by `level6Analytics`; see `GGR_Level6HistoricalResults` in the [flow registry](../power-automate/flow-registry-and-contracts.md#ggr_level6historicalresults-planned).

- Validate event and decision payloads against the content version; reject unknown event IDs.
- **Size limits:**
  - The SharePoint multi-line text and Power Automate payload limits must be measured in the tenant.
  - The snapshot keeps a bounded recent event log.
  - Older events are archived to a separate results list (`GGR_Level6Events`, proposed) with a retention policy.
- **Telemetry:** era reached, decisions taken, score components, payload size. No personal data beyond what is already in progress rows.
- **List queries:** teacher views by class/level/era need indexed columns only where they are actually queried.

## 9. Enablement checklist (all unchecked)

- [ ] Era chronology and content validated with citations and reviewer sign-off
- [ ] Traditional Owner / cultural consultation and review complete
- [ ] Curriculum mapping and completion assessment approved
- [ ] Gameplay implemented and tested (not a placeholder)
- [ ] Scoring normalisation, calibration and anti-gaming validated; `scoringVersion` 1 frozen
- [ ] Save protocol v2 and full cloud restore live-verified
- [ ] `GGR_LoginStudent` / `GGR_UpsertStudentProfile` / `GGR_SaveProgress` validators accept Level 6 (tenant)
- [ ] Teacher unlock/approval policy for 5 → 6 decided; flows cap at the enabled level
- [ ] `GGR_Level6HistoricalResults` built and verified (if analytics are required)
- [ ] Registry entry flipped to playable only after all of the above
