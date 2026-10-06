# Decision: WhatsApp Workout Companion

- **Slug**: whatsapp-workout-tracker
- **Decided**: 2026-10-06T15:14:37+05:30
- **Verdict**: go
- **Artifacts reviewed**: intake.md | research.md | problem.md | concept.md

## Scorecard

| Criterion | Rating | Justification |
|-----------|--------|---------------|
| Problem validity | adequate | The artifacts support a real logging-friction problem for some self-directed intermediate-to-experienced lifters, but the WhatsApp preference itself remains a hypothesis rather than a proven behavior. |
| Evidence strength | adequate | Research confidence is medium: established tracking behavior, friction anecdotes, incumbent comparison, WhatsApp constraints, and AI/logging prior art are documented, while direct user preference and willingness-to-pay evidence remain unresolved. |
| Value vs. inaction | adequate | Doing nothing leaves users with mature trackers, notes, spreadsheets, paper, watches, or memory; the opportunity is worth testing only if conversational capture preserves accurate history with less perceived interruption. |
| Feasibility / appetite | adequate | Concept B can be kept within a pilot-sized scope if it focuses on fast capture, trustworthy structured history, last values, PR detection, bounded history questions, and custom exercise understanding, without autonomous training decisions. |
| Strategic fit | adequate | The preferred concept aligns with the assessment's stated goals and non-goals: validate lower-friction workout tracking and bounded AI assistance while excluding trainer, nutrition, medical, social, wearable, and autonomous programming scope. |
| Risk posture | adequate | The major risks are identified and partially bounded: AI must not be final authority on durable records, WhatsApp is reserved for lightweight capture and context, web handles denser review, and Concept C-style coaching is excluded; however pricing, privacy, acceptable error tolerance, and user preference remain unresolved. |

## Verdict & Rationale

**Conditional GO.** Concept B is worth handing to `$speckit-specify` because the evidence adequately supports the problem of in-session workout logging friction, the target user is coherent, and Concept B is materially stronger than Concept A by combining fast conversational capture with the history value users already rely on for progression. It also avoids Concept C's major risks by remaining a tracker and intelligent companion rather than an autonomous trainer. This is not a broad endorsement of AI workout coaching, and "AI parsing exists" is not treated as differentiation. The strongest product thesis is: fast conversational workout capture plus trustworthy structured history plus useful in-session training context.

The go is conditional because several important assumptions are unresolved but not blockers before a first pilot: exact launch country, pricing model, willingness to pay, final WhatsApp economics, acceptable AI error threshold, whether progression recommendations are required for retention, detailed workout notation rules, and final privacy and retention commitments. These should remain carried-forward unknowns, not be prematurely resolved in specification.

## Conditional GO Conditions

- The first version must validate Concept B, not drift into Concept C: no autonomous workout programming, automatic progression decisions, adaptive exercise selection, volume changes, deload decisions, form coaching, medical guidance, nutrition, or trainer replacement.
- The product must compete on the combined thesis of fast WhatsApp capture, accurate structured history, and useful in-session context; AI parsing alone is insufficient differentiation.
- AI responsibility must stay bounded to interpretation, alias/custom exercise understanding, history-question assistance, simple pattern explanation, sparse motivation, and uncertainty handling, with durable workout state kept validated and correctable.
- The initial scope must be small enough to test one normal training week for target users, including capture accuracy, previous-value usefulness, PR detection, history questions, custom/unknown exercise handling, corrections, and session-level flexibility.
- WhatsApp remains plausible only as a pilot surface if target users are willing to use it during workouts and if message economics and policy constraints do not undermine the intended interaction pattern.
- Privacy, export, deletion, retention, and third-party AI processing expectations must be made clear enough for pilot trust testing, while final commitments remain unresolved until validated.

## Immediate Evidence After First Usable Version

- Whether self-directed intermediate-to-experienced lifters complete one normal training week using WhatsApp capture with lower perceived friction than their current method.
- Whether structured workout history matches user intent for exercises, sets, reps, weights, units, corrections, deletes, custom machines, and session-only changes.
- Whether previous workout values, PR detection, and narrow history questions make Concept B materially more useful than a capture-only Concept A experience.
- Whether clarification and correction burden stays low enough that AI assistance does not erase the friction benefit.
- Whether users trust WhatsApp plus AI-assisted processing for workout history under the presented privacy, export, deletion, and retention terms.
- Whether WhatsApp message volume, response windows, template limits, and country/provider pricing appear compatible with the observed interaction pattern.
- Whether users still ask for progression recommendations, deload guidance, or routine changes as a retention requirement, which would challenge the intended companion boundary.

## If needs-clarification

- **Blocking questions**: N/A
- **Revisit stage**: N/A

## If go - Handoff to `$speckit-specify`

- **Problem**: Self-directed intermediate-to-experienced lifters with existing routines want accurate structured workout history without repeated in-session UI interaction that interrupts training flow.
- **Chosen approach**: Concept B - Intelligent Workout Companion: a WhatsApp-first workout tracking companion that combines lower-friction conversational capture, trustworthy structured workout history, immediate previous-performance context, PR detection, history questions, custom/unknown exercise understanding, and session-level flexibility.
- **In scope / out of scope**: In scope is workout tracking and bounded companion behavior: routine setup and review, WhatsApp session capture, natural-language logging, corrections/deletes, custom exercises, previous values, PR detection, narrow history questions, session-only changes, and web history/analytics. Out of scope is autonomous trainer behavior, automatic programming, automatic progression decisions, adaptive exercise selection, volume or deload decisions, form coaching, medical/rehab guidance, nutrition, social features, wearables, trainer marketplace, exhaustive global exercise databases, and technology or architecture choices.
- **Success metrics**: Use the assessment's pilot-level measures: one-week workout completion, lower perceived friction than current method, reduced active logging attention, accurate structured history, acceptable correction burden, useful history answers for next-workout decisions, acceptance of the WhatsApp plus web product split, and trust readiness around privacy/export/deletion.
- **Carried-forward open questions**: Exact launch country; pricing model; willingness to pay; final WhatsApp messaging economics; acceptable AI error threshold; whether progression recommendations are required for retention; detailed workout notation rules; final privacy, retention, export, deletion, model-training, and third-party processor commitments; whether target users prefer WhatsApp over a purpose-built app; what "complete one normal week" means across routine types.
