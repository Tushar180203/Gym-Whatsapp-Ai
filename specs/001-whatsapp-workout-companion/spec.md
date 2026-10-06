# Feature Specification: WhatsApp Workout Companion

**Feature Branch**: `001-whatsapp-workout-companion`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Create the first product specification for the approved WhatsApp Workout Companion."

## Clarifications

### Session 2026-10-06

- Q: When a user sends "start" in WhatsApp, how should the product choose the proposed workout if the routine has a schedule and the user missed or shifted prior sessions? → A: Rotating next-workout sequence based on completed workout history; missed calendar days do not advance or skip the sequence, schedules remain intended frequency/planned days only, and ambiguous starts require user choice.
- Q: What should happen if a user sends "start" while another workout session is already active? → A: MVP allows only one active workout per user; the product shows the active workout and requires explicit choice to resume, finish, save incomplete, discard, or replace it.
- Q: For MVP set logging, how should the active exercise advance after the user logs sets? → A: Keep the current exercise active until the user explicitly changes exercise context; planned sets are targets and extra sets remain on the current exercise.
- Q: For MVP, how should the product record weights when the user omits units or says "each" for dumbbell-style work? → A: Persist unit and load semantics per weighted set; use preferred units only when safe, preserve per-hand/per-side, total, and machine-stack semantics, and compare only matching or explicitly normalized values.
- Q: For MVP, what should "done" do when the active workout has recorded sets but some planned exercises are unfinished? → A: Treat "done" as a request to end; complete normally only when planned work is completed, skipped, or replaced, otherwise ask to save completed, save incomplete, continue, or discard.
- Q: How should WhatsApp corrections and deletions target existing workout records once the user has moved past the set or exercise they are correcting? → A: Allow natural corrections across the current active workout when one target is clear, including after moving exercises; ambiguous targets must ask; completed workout edits through WhatsApp require confirmation; web supports completed-history editing; unambiguous active-workout "delete last set" may execute directly, while older, ambiguous, exercise, workout, or substantial history deletion requires confirmation.
- Q: How should unknown exercise names and aliases become stable exercise identities for a user? → A: Use confirm-once, reuse-after-confirmation behavior: first-time unknown or unsafe exercise mappings require confirmation, confirmed aliases resolve automatically for that user while unambiguous, similar exercises remain separate by default, global or custom mappings and exercise-history merges require explicit confirmation, and renaming or aliasing preserves the same identity unless the user explicitly creates a new exercise.
- Q: How should the product distinguish session-only workout changes from permanent routine changes in WhatsApp? → A: Treat "today", "this workout", "for this session", simple reordering, and in-workout skip/add/replace language as session-only unless permanent intent is explicit; treat "from now on", "permanently", "in my plan", "to my routine", "from next week", and "remove from my routine" as permanent intent; ambiguous changes ask "Today only or update your routine?"; permanent WhatsApp routine changes require explicit confirmation before applying.
- Q: What history should the product use for "last time," previous-performance context, and MVP PR comparisons? → A: Use only the same confirmed exercise identity with compatible unit and load semantics; confirmed aliases resolve to that identity; do not fall back to similar exercises, machines, or movement families; "last time" means the most recent completed or valid recorded comparable occurrence; show only that most recent comparable session in MVP unless older history is requested; confirmed historical corrections become the source of truth for context, PRs, history questions, and analytics.
- Q: Which WhatsApp history questions and muscle analytics should MVP support without crossing into coaching? → A: Support concise factual questions for last named workout/session, exact exercise last time or best set, weekly primary-muscle set counts, last trained muscle/session, and monthly workout count; ambiguous references ask for clarification; missing data is stated without substitution; coaching questions may return recorded facts and bounded context but no autonomous recommendation; MVP muscle analytics count primary-muscle sets only, exclude uncertain custom exercises until classification is confirmed, allow user correction of custom exercise classification, and avoid secondary-muscle or fractional-volume calculations.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Account, Profile, WhatsApp, And Routine (Priority: P1)

A self-directed lifter creates an account, configures only the profile details needed for workout tracking, chooses preferred weight units, connects their WhatsApp identity to the product account, and creates one or more workout routines that reflect their existing training plan.

**Why this priority**: The companion cannot provide trustworthy in-session capture or previous-performance context until the user has an owned account, a linked WhatsApp identity, units, and at least one usable routine.

**Independent Test**: A target user can set up a complete existing routine with at least two named workout days, known and custom exercises, planned sets, rep targets or ranges, exercise order, and training frequency, then verify that WhatsApp messages are associated with the same account.

**Acceptance Scenarios**:

1. **Given** a new user with no account, **When** they complete onboarding, choose a preferred weight unit, and connect their WhatsApp identity, **Then** the account is ready to receive workout messages from that linked WhatsApp identity.
2. **Given** a linked user, **When** they create a routine with named sessions, exercises, planned sets, rep targets, exercise order, and training frequency, **Then** the routine is available for workout selection and future history context.
3. **Given** an exercise or machine is not present in the global exercise library, **When** the user adds it with a custom name or alias, **Then** the product creates a stable user-specific exercise identity after confirmation.
4. **Given** a user edits planned sets, exercise order, or schedule in the web product, **When** they save the routine, **Then** future workouts use the updated plan without altering past completed workout records.
5. **Given** the user has confirmed "hammer incline" as an alias for a user-specific exercise, **When** they later log "hammer incline 45x10", **Then** the product resolves it to the same exercise identity without repeated confirmation if the mapping remains unambiguous.

---

### User Story 2 - Start And Confirm A Planned Workout From WhatsApp (Priority: P1)

A linked user starts a workout from WhatsApp using natural language, sees the planned session the product believes is relevant, and can start, temporarily modify, choose a different appropriate workout, or skip/rest.

**Why this priority**: The first in-gym moment must be low-friction but safe. Guessing the wrong workout would corrupt the session and undermine trust.

**Independent Test**: A linked user sends "start", "let's start", "gym time", or "start workout"; the product identifies the relevant planned session when context is safe and asks for clarification when it is not.

**Acceptance Scenarios**:

1. **Given** a linked user has exactly one safe next planned workout in the routine sequence based on completed workout history, **When** they send "gym time", **Then** the product shows the planned exercises and offers to start that workout.
2. **Given** multiple workouts are plausible for the current context, **When** the user sends "start", **Then** the product asks the user to choose instead of guessing.
3. **Given** the user chooses to rest or skip today, **When** they confirm that choice, **Then** no workout session is started and no workout is recorded as completed.
4. **Given** the user makes a temporary change before starting, **When** they confirm the workout, **Then** the change applies only to the current session unless the user explicitly asks to update the permanent plan.
5. **Given** a user missed one or more planned calendar days, **When** they send "start", **Then** missed calendar days do not automatically skip workouts or advance the routine sequence.
6. **Given** the user already has an active workout, **When** they send "start", **Then** the product shows the active workout and asks whether to resume, finish, save incomplete, discard, or explicitly replace it.
7. **Given** the user asks through WhatsApp to permanently change their routine, **When** the requested change is clear, **Then** the product asks for explicit confirmation before changing the permanent routine.

---

### User Story 3 - Log A Complete Workout Conversationally (Priority: P1)

During an active workout, the user logs one set, multiple sets, or a whole exercise using natural language while the product preserves structured workout data and keeps replies concise enough for active gym use.

**Why this priority**: Fast conversational capture plus accurate structured history is the core product thesis.

**Independent Test**: A user completes a planned workout entirely through WhatsApp messages without opening the web dashboard during the session, and the resulting history accurately reflects exercises, set order, weights, units, reps, and completion state.

**Acceptance Scenarios**:

1. **Given** an active exercise, **When** the user sends "45x10", "45 kg x 10", "45 each 10", "45kg for 10", "same x 9", or "50x8 failed the 9th", **Then** the product records only the structured values it can safely determine and preserves relevant notes such as failed attempt context when supported.
2. **Given** an active workout, **When** the user sends "45x10, 45x9, 45x8", **Then** the product records three ordered sets for the intended exercise.
3. **Given** an active workout, **When** the user sends "bench 80x8 80x8 80x7", **Then** the product associates the sets with bench if that exercise identity is safe in the user's current context.
4. **Given** a message lacks required numerical values, **When** the missing values cannot be safely inferred from confirmed context, **Then** the product asks for clarification and does not invent workout data.
5. **Given** the planned set count for the active exercise has been reached, **When** the user logs another set without changing exercise context, **Then** the product records it as an extra set for the current exercise rather than automatically advancing.
6. **Given** the user logs "45 each 10" for a dumbbell-style exercise, **When** the unit is omitted but the user's preferred unit is safe to apply, **Then** the product records 45, the preferred unit, per-hand/per-side load semantics, and 10 reps.

---

### User Story 4 - Correct, Reorder, Skip, Replace, And Add During A Session (Priority: P1)

The user naturally corrects captured data, changes exercise order when equipment is unavailable, skips or replaces exercises, and adds extra or unknown exercises while preserving the difference between today's session and the permanent plan.

**Why this priority**: Real workouts are messy. The product must stay accurate when the gym is busy, mistakes happen, or a local machine is not in the library.

**Independent Test**: During an active workout, a user performs exercises out of order, deletes or edits a prior set, replaces an exercise for today only, and adds a custom machine; the final workout history is correct and the permanent plan changes only after explicit user intent.

**Acceptance Scenarios**:

1. **Given** the last captured set is 50 kg x 8, **When** the user sends "that was 45 not 50", **Then** the product updates the intended existing set rather than creating a new set.
2. **Given** multiple records could match a correction, **When** the user sends "actually that was 9", **Then** the product asks which set or exercise they mean before changing durable history.
3. **Given** the user has moved from incline dumbbell press to shoulder press in the current active workout, **When** they send "incline set 2 was actually 11", **Then** the product updates Incline Dumbbell Press Set 2 if that reference is unique.
4. **Given** the user asks to correct a completed workout through WhatsApp, **When** the intended set or exercise is clear, **Then** the product shows the proposed edit and requires confirmation before changing completed workout history.
5. **Given** bench is planned first, **When** the user sends "Bench is busy, let's do shoulder press first", **Then** the active session order changes and the permanent routine remains unchanged.
6. **Given** a user replaces an exercise for the current workout, **When** they do not explicitly ask to update the plan, **Then** the replacement is marked session-only.
7. **Given** the user adds "red chest machine" during a workout, **When** the product cannot safely match it to an existing user-specific exercise, **Then** it asks for confirmation before creating or mapping a stable custom exercise identity.
8. **Given** the user says "replace incline with machine press" during a workout without saying whether it is temporary or permanent, **When** the product cannot determine intent safely, **Then** it asks whether the change is for today only or should update the routine.

---

### User Story 5 - Use Previous Performance And Finish The Workout (Priority: P2)

For each active exercise, the user receives concise planned-target and previous-performance context when available, then finishes the workout naturally and receives an accurate summary.

**Why this priority**: The approved concept is a companion, not merely a chat input. Previous-performance context makes structured history useful during the next workout.

**Independent Test**: A returning user starts a workout containing an exercise performed previously; the product shows target sets/reps and last recorded performance, then produces a completion summary based only on recorded or deterministically calculated data.

**Acceptance Scenarios**:

1. **Given** the user starts Incline Dumbbell Press with prior history, **When** the exercise becomes active, **Then** the product shows the exercise name, target sets and rep range, and last recorded performance in a compact format.
2. **Given** no previous performance exists for the active exercise, **When** context is shown, **Then** the product states that no previous record is available rather than inventing one.
3. **Given** prior history exists only for a similar but different exercise identity, **When** the active exercise needs previous-performance context, **Then** the product states that no previous record is available for the exact exercise rather than using similar-exercise history.
4. **Given** the user sends "finish workout", "done", or an equivalent completion intent, **When** the workout has recorded data, **Then** the product summarizes exercises completed, sets completed, notable deterministic PRs, and session duration when available.
5. **Given** a workout has no recorded sets, **When** the user attempts to finish it, **Then** the product confirms whether the user wants to discard, save as incomplete, or continue.
6. **Given** the user resumes an active workout, **When** they continue logging, **Then** subsequent workout messages apply to the existing active session.
7. **Given** planned exercises remain unfinished, **When** the user says "done", **Then** the product asks whether to save as completed, save as incomplete, continue workout, or discard workout.

---

### User Story 6 - Review History, Analytics, And Bounded Questions (Priority: P2)

The user reviews detailed workout history and analytics on the web product and asks bounded WhatsApp questions that are answered from persisted workout data.

**Why this priority**: Trustworthy history and useful retrieval are the product's durable value after a workout is captured.

**Independent Test**: After logging multiple workouts, a user can review history and analytics on the web product and ask WhatsApp questions such as "what did I incline press last time?" or "how many chest sets did I do this week?" with answers grounded in stored records.

**Acceptance Scenarios**:

1. **Given** completed workout history exists, **When** the user opens the web product, **Then** they can review past workouts, exercise history, previous weights and reps, progression over time, workout frequency, completed workouts, weekly training sets, muscle training frequency, and workout history.
2. **Given** the user asks "what did I do last push day?", **When** a prior push day can be identified from persisted routine and workout history, **Then** the product answers with the recorded exercises and sets from that session.
3. **Given** the user asks "what's my best incline press?", **When** relevant history exists, **Then** the product reports deterministic PR values such as highest recorded weight or highest reps at a given weight.
4. **Given** the user asks "how many chest sets did I do this week?", **When** chest is confirmed as a primary muscle for recorded exercises, **Then** the product answers with the weekly primary-muscle set count only.
5. **Given** the user asks "what should I bench today?", "should I deload?", or "am I training chest enough?", **When** relevant recorded facts exist, **Then** the product may provide concise historical context but does not make an autonomous training decision.
6. **Given** the user asks an unbounded or unsupported question, **When** the product cannot answer from persisted workout data, **Then** it explains the limitation and does not invent values or training advice.

---

### User Story 7 - Control Stored Workout Data (Priority: P3)

The user can understand what workout data is stored, correct it, export it, and delete their account or workout data through a clear path.

**Why this priority**: Trust, correction, portability, and deletion are necessary for a product that processes workout data through a chat surface, even though detailed retention commitments remain open for later decision.

**Independent Test**: A user can find stored workout information, edit an incorrect record, request an export of their workout data, and request account/data deletion without needing support intervention for ordinary cases.

**Acceptance Scenarios**:

1. **Given** the user reviews a past workout, **When** they correct an exercise, set, weight, reps, or unit, **Then** future history and analytics reflect the corrected structured record.
2. **Given** the user requests export, **When** export is available, **Then** the product provides the user's workout data in an understandable portable form.
3. **Given** the user requests account or data deletion, **When** the request is confirmed, **Then** the product follows the defined deletion path and clearly communicates the result.

### Edge Cases

- A WhatsApp message arrives from an unlinked identity.
- A linked user has no configured workout routines.
- More than one routine or workout session is plausible for "start" based on routine sequence, explicit user context, schedule, or recent history.
- The user sends set data before a workout or exercise is active.
- The user sends "start" while another workout session is active.
- A message includes approximate or uncertain values such as "around 40 something for 8".
- A user switches between kg and lb or mentions a unit different from their preferred unit.
- A weight value omits kg/lb and the preferred-unit fallback is unsafe or ambiguous.
- A load could be interpreted as per-hand/per-side, total load, or machine-stack load.
- "Same" is used when no previous set exists in the current context.
- Planned sets are reached but the user has not explicitly changed exercise context.
- A correction could refer to more than one recent set, exercise, or workout.
- A destructive action such as delete is ambiguous.
- A user corrects a set from an earlier exercise in the current active workout after moving to another exercise.
- A user requests a WhatsApp correction to a completed workout.
- A user asks to delete an older set, entire exercise, entire workout, or substantial block of history.
- A temporary session change resembles a permanent plan-change request.
- A user says "replace incline with machine press", "add rear delts", "skip cable fly", or "remove this exercise" without clear session-only or permanent wording.
- A user requests a permanent routine change through WhatsApp.
- A custom exercise name resembles an existing exercise but may refer to a different machine.
- A user-defined alias conflicts with another user-defined alias or global exercise name.
- A custom exercise resembles a known/global exercise but may not be the same movement or machine.
- A user renames an exercise or adds an alias and expects history to remain attached to the same exercise identity.
- Previous-performance context exists for a similar but not identical exercise.
- A confirmed alias is used when asking for previous performance or recording a set.
- A prior set has the same exercise identity but incompatible unit or load semantics for comparison.
- A history question asks for data outside the user's stored history or data ownership boundary.
- A history question references a workout, exercise, or muscle that could match multiple records.
- A user asks for coaching, programming, deload, or exercise-load recommendations instead of historical facts.
- Analytics depend on custom exercises that do not yet have confirmed muscle classification.
- A workout is abandoned, partially completed, or completed without all planned exercises.
- The user says "done" while planned exercises remain unfinished.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST allow users to create an account.
- **FR-002**: The product MUST allow users to configure basic profile information relevant to workout tracking and MUST NOT require additional profile information unless needed for a defined user journey.
- **FR-003**: The product MUST allow users to choose a preferred weight unit for workout tracking.
- **FR-004**: The product MUST allow users to connect a WhatsApp identity to their product account.
- **FR-005**: The product MUST reject or safely ignore workout-affecting messages from WhatsApp identities that are not linked to an account.
- **FR-006**: Users MUST be able to create one or more workout routines.
- **FR-007**: Users MUST be able to name workout days or sessions within a routine.
- **FR-008**: Users MUST be able to add known exercises and user-defined custom exercises to workout routines.
- **FR-009**: Users MUST be able to specify planned sets for each planned exercise.
- **FR-010**: Users MUST be able to specify rep targets or rep ranges for planned exercises.
- **FR-011**: Users MUST be able to arrange exercise order within a planned workout.
- **FR-012**: Users MUST be able to configure training frequency or schedule for routines; for MVP, schedule represents intended frequency or planned days and MUST NOT override the routine sequence after schedule drift.
- **FR-013**: The product MUST NOT assume the global exercise library contains every possible exercise or machine.
- **FR-014**: Users MUST be able to add an exercise or machine that does not exist in the global exercise library.
- **FR-015**: The product MUST support user-created exercise names and aliases such as "hammer incline", "red chest machine", "new Atlantis press", and "gym rear delt machine".
- **FR-016**: The product MUST establish a stable user-specific exercise identity once a custom or unknown exercise is confirmed.
- **FR-017**: The product MUST NOT merge or mix progression history across distinct exercise identities unless the user confirms the mapping.
- **FR-018**: The product MAY assist users with classifying or understanding custom exercises, but the confirmed user-specific identity MUST remain stable.
- **FR-018a**: When an exercise name cannot be safely resolved to an existing confirmed exercise identity, the product MUST ask for confirmation before creating a new stable user-specific exercise or mapping the phrase to an existing exercise.
- **FR-018b**: After the user confirms an alias mapping, the product MUST reuse that alias automatically for that user in future sessions when the mapping remains unambiguous.
- **FR-018c**: If the same or similar alias could resolve to multiple exercises, the product MUST ask for clarification instead of guessing.
- **FR-018d**: Similar exercises or machines, including Hammer Strength Incline Press, Smith Incline Press, Incline Dumbbell Press, and Plate-Loaded Incline Press, MUST keep separate progression histories by default.
- **FR-018e**: A custom exercise MAY map to a known/global exercise only when the mapping is safe; if ambiguity exists, confirmation is required before mapping or merging history.
- **FR-018f**: Merging two existing exercise identities or their histories MUST always require explicit user confirmation and MUST NOT happen automatically.
- **FR-018g**: Renaming an exercise MUST preserve the same exercise identity, and adding an alias MUST create another phrase for the same identity; neither action creates a new progression history unless the user explicitly creates a new exercise.
- **FR-018h**: Confirmed exercise identity MUST be used consistently for workout history, PR detection, previous-performance context, analytics, and future alias resolution.
- **FR-019**: A linked user MUST be able to start a workout from WhatsApp using natural language such as "start", "let's start", "gym time", or "start workout".
- **FR-020**: For MVP, when a linked user sends a start intent without naming a workout, the product MUST propose the next planned workout in the routine sequence based on completed workout history rather than strictly using the calendar day.
- **FR-021**: The product MUST ask for clarification when the correct workout cannot be determined safely.
- **FR-022**: Before or when starting a workout, the product MUST show the planned exercises for the proposed session.
- **FR-023**: Before or when starting a workout, users MUST be able to start the planned workout, make a temporary change, choose another appropriate workout, or skip/rest.
- **FR-024**: Temporary workout changes MUST NOT silently modify the permanent workout plan.
- **FR-024a**: Missed calendar days MUST NOT automatically skip planned workouts or advance the routine sequence.
- **FR-024b**: Users MUST be able to explicitly choose a different workout for the current session without permanently changing the routine sequence unless they explicitly request a permanent change.
- **FR-024c**: For MVP, the product MUST allow only one active workout session per user.
- **FR-024d**: If a user sends a start intent while a workout is active, the product MUST NOT create a second active session or silently modify the existing one; it MUST show the active workout and require the user to choose resume, finish, save incomplete, discard, or replace.
- **FR-024e**: Replacing an active workout with a new workout MUST require explicit user intent.
- **FR-024f**: When the user resumes an active workout, subsequent workout messages MUST continue against that existing active session.
- **FR-025**: For the active exercise, the product MUST provide concise context including exercise name and planned sets or rep target.
- **FR-026**: For the active exercise, the product MUST provide previous workout performance when available from persisted history.
- **FR-027**: Previous-performance context MUST be concise enough for active gym use.
- **FR-027a**: Previous-performance context and "last time" answers MUST use only the same confirmed exercise identity; confirmed aliases MUST resolve to that same identity.
- **FR-027b**: For MVP, "last time" MUST mean the most recent completed or otherwise valid recorded occurrence of the exact confirmed exercise identity with comparable unit and load semantics.
- **FR-027c**: For MVP, previous-performance context MUST show only the most recent comparable session unless the user explicitly asks for older history.
- **FR-027d**: If no exact comparable history exists, the product MUST state that no previous record exists for that exercise rather than using similar exercises, machines, or movement families.
- **FR-028**: Users MUST be able to log workout sets using natural language.
- **FR-029**: Set logging MUST support single-set examples including "45x10", "45 kg x 10", "45 each 10", "45kg for 10", "same x 9", and "50x8 failed the 9th".
- **FR-030**: For each safely interpreted set, the product MUST preserve structured values for exercise, set order, weight, unit, load semantics, and reps where known.
- **FR-030a**: For MVP, supported load semantics for weighted sets MUST include at least unspecified/default, per-hand/per-side, total load, and machine stack.
- **FR-030b**: If the user omits kg/lb, the product MUST use the user's preferred unit only when the exercise and set context are otherwise safe and unambiguous.
- **FR-030c**: The product MUST interpret "each" in supported set notation as per-hand/per-side load when the exercise context is safe.
- **FR-030d**: The product MUST NOT automatically convert per-hand/per-side values into combined total load for durable history.
- **FR-030e**: A selectorized-machine value MAY be stored as machine-stack load when that semantic is known from confirmed exercise context.
- **FR-030f**: Previous-performance comparisons and PR detection MUST compare matching unit and load semantics unless values have been explicitly and safely normalized.
- **FR-030g**: If load semantics are materially ambiguous and would affect durable history, previous-performance comparison, or PR detection, the product MUST ask for clarification rather than guessing.
- **FR-031**: The product MUST NOT invent missing numerical values.
- **FR-032**: The product MUST ask for clarification when confidence is insufficient for an action affecting durable workout history.
- **FR-033**: Users MUST be able to log multiple sets in one message.
- **FR-034**: Multiple-set logging MUST support messages such as "45x10, 45x9, 45x8" and "bench 80x8 80x8 80x7" when intent is clear.
- **FR-035**: The product MUST keep the current exercise active until the user explicitly changes exercise context by saying "next", naming or selecting another exercise, asking to do another exercise first, skipping, replacing, or finishing the workout.
- **FR-035a**: Reaching the planned set count MUST NOT automatically advance the active exercise because planned sets are targets, not proof that the user is finished.
- **FR-035b**: When the planned set count is reached, the product MAY concisely suggest the next planned exercise, but it MUST NOT change the active exercise until the user explicitly transitions.
- **FR-035c**: Extra sets beyond the planned count MUST be allowed and remain associated with the current active exercise until the user explicitly transitions.
- **FR-035d**: The product MUST leave room for whole-exercise logging when the user's intent is clear.
- **FR-036**: Users MUST be able to correct previously captured data using natural language.
- **FR-037**: Corrections MUST update the intended existing record rather than silently creating another set.
- **FR-038**: The product MUST ask for clarification when the target of a correction is ambiguous.
- **FR-039**: Users MUST be able to delete the last set and edit a named or numbered set when the target is clear.
- **FR-039a**: During an active workout, natural corrections MAY target any set or exercise in that active workout, including after the user has moved to another exercise, when there is one clear target.
- **FR-039b**: Implicit correction references such as "last one", "previous set", or "that set" MUST resolve only from recent workout context when there is one clear interpretation and MUST NOT modify older unrelated workout history.
- **FR-039c**: Completed workout records MAY be corrected through WhatsApp when the intended record is clear, but the product MUST require confirmation of the proposed edit before changing completed workout history.
- **FR-039d**: The web product MUST allow users to edit completed workout history.
- **FR-039e**: "Delete last set" MAY execute directly during an active workout when the target is unambiguous; deleting an older or ambiguous set MUST require clarification or confirmation.
- **FR-039f**: Deleting an entire exercise record, an entire completed workout, or a substantial block of history MUST require explicit confirmation before execution.
- **FR-039g**: Corrections, deletions, analytics, personal records, history answers, and previous-performance context MUST reflect the corrected durable data after an edit is applied.
- **FR-040**: Users MUST be able to perform exercises in a different order from the planned routine during an active workout.
- **FR-041**: Session exercise-order changes MUST apply only to the current session unless the user explicitly asks to update the permanent plan.
- **FR-042**: Users MUST be able to skip a set during an active workout.
- **FR-043**: Users MUST be able to skip an exercise during an active workout.
- **FR-044**: Users MUST be able to change the active exercise during an active workout.
- **FR-045**: Users MUST be able to replace an exercise for the current session.
- **FR-046**: Users MUST be able to add an extra exercise during a workout.
- **FR-047**: Users MUST be able to add a previously unknown or custom machine during a workout.
- **FR-048**: The product MUST clearly distinguish "today/session only" changes from permanent plan changes.
- **FR-049**: Permanent plan changes MUST require explicit user intent.
- **FR-049a**: Phrases such as "today", "this workout", "for this session", "do X first", "skip X today", "replace X with Y today", and "add this just for today" MUST apply only to the current workout session.
- **FR-049b**: Simple in-workout reordering, skipping, adding, replacing, or removing language MUST be treated as session-only unless the user expresses permanent intent.
- **FR-049c**: Phrases such as "from now on", "permanently", "add this to my routine", "replace X with Y in my plan", "from next week", and "remove this from my routine" MUST be treated as permanent routine-change intent.
- **FR-049d**: Ambiguous workout modifications MUST NOT silently modify the permanent routine; the product MUST either treat them as session-only when safe or ask whether the change is today only or should update the routine.
- **FR-049e**: Permanent routine changes MAY be requested through WhatsApp, but the product MUST ask for explicit confirmation before applying the permanent routine change.
- **FR-049f**: Permanent routine reordering MUST be explicitly requested and confirmed.
- **FR-050**: Users MUST be able to finish a workout naturally from WhatsApp.
- **FR-051**: On workout completion, the product MUST provide a concise summary containing relevant recorded data, such as exercises completed, sets completed, notable deterministic PRs, and session duration where available.
- **FR-052**: The product MUST NOT invent workout-completion metrics that were not captured or deterministically calculated.
- **FR-052a**: The product MUST treat "done" or equivalent completion intent as an explicit request to end the current workout.
- **FR-052b**: If all planned work has been completed, skipped, or replaced, the product MAY complete the workout normally.
- **FR-052c**: If planned exercises remain unfinished, the product MUST NOT silently mark the workout completed; it MUST ask the user to choose save as completed, save as incomplete, continue workout, or discard workout.
- **FR-052d**: Saving as completed MUST mean the user intentionally considers the session complete despite unfinished planned items.
- **FR-052e**: Saving as incomplete MUST preserve recorded workout data while marking the session incomplete.
- **FR-052f**: Continuing workout MUST keep the same active workout session.
- **FR-052g**: Discarding workout MUST remove or abandon the current session according to the product's defined discard behavior.
- **FR-052h**: Completion status MUST be explicit and deterministic because it affects workout history, adherence analytics, summaries, and future scheduling.
- **FR-053**: Users MUST be able to review past workouts.
- **FR-054**: Users MUST be able to review exercise history, previous weights and reps, and progression over time.
- **FR-055**: The web product MUST support detailed workout-history review.
- **FR-056**: The product MUST identify straightforward personal records based on persisted workout history.
- **FR-057**: Initial PR detection MUST include deterministic records such as highest recorded weight and highest reps at a given weight.
- **FR-057a**: MVP PR comparisons MUST require exact confirmed exercise identity and compatible unit and load semantics unless values have been explicitly and safely normalized.
- **FR-057b**: Session-only substitutions MUST use the substituted exercise identity's independent history and MUST NOT share PRs with the replaced exercise unless the identities have been explicitly merged.
- **FR-058**: Users MUST be able to ask bounded workout-history questions through WhatsApp.
- **FR-059**: WhatsApp history answers MUST be grounded in persisted workout data.
- **FR-060**: The product MUST NOT invent historical values in answers.
- **FR-060a**: MVP WhatsApp history questions MUST support factual requests for last named workout/session, last occurrence of an exact exercise, best recorded set for an exact exercise, weekly set count for a muscle, last time a muscle or session was trained, and monthly workout count.
- **FR-060b**: If a workout, exercise, or muscle reference in a history question could match multiple valid records, the product MUST ask for clarification.
- **FR-060c**: If requested historical or analytics data does not exist, the product MUST say so clearly and MUST NOT substitute a similar exercise, workout, or muscle unless the user explicitly asks for broader comparison.
- **FR-060d**: For coaching or training-decision questions, the product MAY provide relevant recorded facts and bounded context, but MUST NOT make autonomous workout programming, progression, deload, volume, or exercise-selection decisions.
- **FR-061**: The web product MUST provide analytics for workout frequency, completed workouts, exercise progression, weekly training sets, muscle training frequency, and workout history.
- **FR-062**: Analytics values MUST derive from persisted structured data.
- **FR-063**: Exercises MAY have primary muscle groups, secondary muscle groups, and movement or exercise family.
- **FR-064**: Custom exercises MAY be classified with assistance, but classification MUST be confirmed or safely marked uncertain before analytics depend on it.
- **FR-065**: The first version MUST NOT require an exhaustive global exercise database.
- **FR-066**: The first version MUST NOT require advanced fractional muscle-volume calculations.
- **FR-066a**: MVP weekly muscle-set analytics MUST count only sets where the muscle is classified as a primary muscle.
- **FR-066b**: Secondary muscle groups MUST NOT contribute to MVP muscle-set totals.
- **FR-066c**: Custom exercises with confirmed primary-muscle classification MUST be included in muscle analytics; custom exercises with missing or uncertain classification MUST be excluded until confirmed.
- **FR-066d**: Users MUST be able to correct the muscle classification of their custom exercises, and future analytics MUST use the corrected confirmed classification.
- **FR-067**: The product MAY provide sparse, contextual motivational responses after sets, performance improvements, PRs, or workout completion.
- **FR-068**: Motivational feedback MUST NOT be required after every set.
- **FR-069**: The product MUST remain useful when motivational feedback is minimized.
- **FR-070**: AI MAY assist with user intent recognition, messy workout language, exercise aliases, unknown or custom exercise understanding, conversational references, correction interpretation, bounded history questions, and concise natural-language responses.
- **FR-071**: AI MUST NOT directly persist workout state.
- **FR-072**: Validated application logic MUST control workout state, persisted set data, units, confirmed exercise identity, corrections, deletes, permanent plan changes, PR calculations, analytics calculations, authorization, and data ownership.
- **FR-073**: Users MUST have an understandable path to review stored workout information.
- **FR-074**: Users MUST have an understandable path to correct stored workout information.
- **FR-075**: Users MUST have an understandable path to export their workout data.
- **FR-076**: Users MUST have an understandable path to delete their account or data.
- **FR-077**: The first version MUST explicitly exclude autonomous workout programming, automatic progression decisions, adaptive training plans, automatic volume modification, automatic deload decisions, form coaching, medical or rehabilitation guidance, nutrition coaching, calorie tracking, meal planning, social feed, wearable integrations, trainer marketplace, replacing a professional trainer, and an exhaustive global exercise database.

### Key Entities *(include if feature involves data)*

- **User Account**: Represents the product user and owns profile information, preferred units, WhatsApp link, routines, workout history, custom exercises, exports, and deletion requests.
- **WhatsApp Identity Link**: Represents the confirmed association between a WhatsApp identity and one product account for authorization, ownership, and message routing.
- **Workout Profile**: Represents basic workout-tracking preferences such as preferred weight unit and any minimal profile attributes required for workout history and analytics.
- **Routine**: Represents an existing training program configured by the user, including one or more named workout sessions, their rotating sequence order, and a training frequency or schedule used as intended timing rather than the sole source of workout selection.
- **Workout Session Template**: Represents a named planned workout day or session within a routine, including ordered planned exercises, planned sets, and rep targets or ranges.
- **Exercise Identity**: Represents either a known exercise or a stable user-specific custom exercise or machine. It may include display name, user aliases, primary and secondary muscle groups, movement or exercise family, and confirmed mappings to known/global exercises or other user-specific identities.
- **Planned Exercise**: Represents an exercise inside a planned session, including order, planned sets, and rep target.
- **Active Workout Session**: Represents a started workout, its selected plan, temporary session-only changes, active exercise, logged sets, skipped items, completion status, and duration where available. For MVP, at most one Active Workout Session may be active per user at a time.
- **Workout Set**: Represents a recorded set with exercise identity, set order, weight, unit, load semantics, reps, and any supported notes such as failed attempt context.
- **Correction**: Represents an update or deletion applied to an existing workout record, including the targeted record, whether confirmation is required, and the resulting structured change.
- **History Answer**: Represents a bounded response to a user question that is grounded in persisted workout data.
- **Personal Record**: Represents a deterministic achievement derived from persisted workout history, such as highest recorded weight or highest reps at a given weight.
- **Analytics Summary**: Represents calculated workout frequency, completed workouts, exercise progression, weekly training sets, primary-muscle training frequency, and related history views derived from confirmed structured data.
- **Data Control Request**: Represents user-initiated review, correction, export, or account/data deletion actions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 80% of pilot users can configure an existing routine, connect WhatsApp, start a workout, and complete one full planned workout without needing the web dashboard during the session.
- **SC-002**: At least 70% of pilot users report that in-session logging feels lower-friction than their current method after completing one normal training week.
- **SC-003**: At least 90% of reviewed logged set entries in pilot workouts correctly preserve exercise identity, set order, weight, unit, load semantics, and reps after user review and correction.
- **SC-004**: Pilot users average fewer than 1 clarification or correction per 10 logged sets, excluding intentional first-time custom exercise creation.
- **SC-005**: At least 80% of returning pilot workouts show useful previous-performance context for at least one exercise with prior history.
- **SC-006**: At least 80% of bounded WhatsApp history questions in pilot testing are answered from persisted workout data or safely declined when data is unavailable.
- **SC-007**: 100% of ambiguous durable-history actions in test scenarios either resolve from confirmed context or ask for clarification rather than silently persisting guessed data.
- **SC-008**: 100% of session-only exercise-order, skip, replace, and add actions in test scenarios leave the permanent plan unchanged unless the user explicitly requests a permanent update.
- **SC-009**: At least 80% of pilot users can review useful workout history and analytics on web after logging multiple workouts.
- **SC-010**: At least 70% of pilot users agree that the product's role is clear as a workout companion and tracker, not an autonomous trainer.

## Assumptions

- Target users are self-directed intermediate-to-experienced lifters who already have a workout routine and primarily need faster capture, trustworthy history, and useful previous-performance context.
- The first usable product is evaluated as a pilot-level product; numeric success thresholds are assumptions until validated with real users.
- WhatsApp is the in-session surface for lightweight capture, correction, previous-performance context, and bounded history questions.
- The web product is the surface for setup, detailed history review, analytics, stored-data review, correction-heavy workflows, export, and deletion paths.
- Users may train with kg or lb, and their preferred unit provides the default when a message omits a unit and the exercise and set context are otherwise safe.
- Detailed supported notation remains subject to future clarification; the first version must support the examples explicitly listed in this specification.
- Warmups, supersets, drop sets, RPE/RIR, and failure-set semantics remain open for later clarification unless they can be captured safely as simple notes without changing core set data.
- Session duration is available only when the product has enough start and finish information to calculate it.
- Straightforward MVP PR detection is limited to deterministic records from corrected durable data for exact confirmed exercise identity with compatible unit and load semantics.
- Muscle classification supports useful first-version analytics but does not require exhaustive global coverage or fractional volume calculations.
- Privacy, retention, model-training, and third-party processing commitments require later definition before production release; this specification only requires understandable review, correction, export, and deletion paths.
- Launch country, pricing model, willingness to pay, WhatsApp messaging economics, acceptable AI error threshold, reminder behavior, and whether progression recommendations are necessary for retention remain carried-forward open questions.
