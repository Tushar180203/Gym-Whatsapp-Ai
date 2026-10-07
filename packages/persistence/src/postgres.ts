import { readFileSync } from "node:fs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { LoadSemantics, NormalizedWhatsAppMessage, WeightUnit } from "../../contracts/src/index.js";
import { DomainError, sha256 } from "./store.js";
import { hasSetNotation, parseSetMessage } from "../../domain/src/parser/set-parser.js";
import type { IntentInterpreter } from "../../ai/src/interfaces.js";
import { Us4Commands } from "./us4.js";
import { handleDeterministicUs4Message } from "../../domain/src/messaging/inbound-message-processor.js";
import { SetInputSchema, parseProposedActionEnvelope, type SetInput } from "../../contracts/src/ai/actions.js";
import { parseCompletionIntent, type CompletionIntent } from "../../domain/src/workouts/completion-policy.js";
import { isResumeIntent } from "../../domain/src/workouts/resume-workout-command.js";
import { WorkoutHistoryQueries } from "./workout-history-queries.js";
import { WorkoutLifecycle } from "./workout-lifecycle.js";
import { AnalyticsQueries } from "./analytics-queries.js";
import { DataControls, exportRequestSchema, deleteRequestSchema, confirmDeletionSchema } from "./data-controls.js";
import { workoutAnalytics } from "../../analytics/src/workout-analytics-service.js";
import { answerHistoryQuestion, coachingBoundary, type HistoryAction, type HistorySnapshot } from "../../analytics/src/history-question-service.js";
import { ProposedActionSchema } from "../../contracts/src/ai/actions.js";
import { isCoachingQuestion, parseHistoryQuestion } from "../../domain/src/messaging/history-query-parser.js";

export type PostgresSliceConfig = {
  connectionString: string;
  interpreter?: IntentInterpreter;
};

export type PgHistoryEntry = {
  workout: { id: string; status: string; name: string; durationSeconds: number | null; trainedAt: Date };
  sets: Array<{
    loadValue: number;
    weightUnit: WeightUnit;
    loadSemantics: LoadSemantics;
    reps: number;
    setIndex: number;
  }>;
};
export type EditableHistory = {
  workout: { id: string; name: string; status: string; version: number };
  sets: Array<{ id: string; exerciseName: string; setIndex: number; loadValue: number; weightUnit: WeightUnit; loadSemantics: LoadSemantics; reps: number }>;
  exercises: Array<{ id: string; exerciseIdentityId: string; name: string; status: string; orderIndex: number; plannedSets: number | null; repTargetMin: number | null; repTargetMax: number | null }>;
  summary: string;
};

export class PostgresVerticalSliceApp {
  readonly pool: Pool;
  private readonly interpreter: IntentInterpreter | undefined;

  constructor(config: PostgresSliceConfig) {
    this.pool = new Pool({ connectionString: config.connectionString });
    this.interpreter = config.interpreter;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async migrate(migrationPath?: string): Promise<void> {
    if (migrationPath) { await this.pool.query(readFileSync(migrationPath, "utf8")); return; }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(40104002)");
      await client.query("create table if not exists schema_migrations(name text primary key)");
      for (const name of ["0001_vertical_slice.sql", "0002_us4.sql", "0003_us5.sql", "0004_us6.sql", "0005_us7.sql"]) {
        if ((await client.query("select name from schema_migrations where name=$1", [name])).rows.length) continue;
        const adopted = name === "0001_vertical_slice.sql" && (await client.query("select to_regclass('users') as name")).rows[0]?.name;
        if (!adopted) await client.query(readFileSync(`packages/persistence/migrations/${name}`, "utf8"));
        await client.query("insert into schema_migrations(name) values($1)", [name]);
      }
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async signUp(email: string, password: string): Promise<{ userId: string; sessionToken: string }> {
    if (password.length < 12) throw new DomainError("Weak password", "WEAK_PASSWORD");
    const userId = id("user");
    const sessionId = id("session");
    const sessionToken = token();
    await this.pool.query(
      `insert into users (id, email, password_hash) values ($1, $2, $3)`,
      [userId, email.toLowerCase(), hashPassword(password)]
    );
    await this.pool.query(
      `insert into auth_sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`,
      [sessionId, userId, sha256(sessionToken)]
    );
    return { userId, sessionToken };
  }

  async currentUser(sessionToken: string): Promise<string> {
    const result = await this.pool.query<{ user_id: string }>(
      `select s.user_id
       from auth_sessions s
       join users u on u.id = s.user_id
       where s.token_hash = $1 and s.invalidated_at is null and s.expires_at > now() and u.deleted_at is null`,
      [sha256(sessionToken)]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
    return row.user_id;
  }

  async logout(sessionToken: string): Promise<void> {
    await this.pool.query(`update auth_sessions set invalidated_at = now() where token_hash = $1`, [
      sha256(sessionToken)
    ]);
  }

  async setPreferredWeightUnit(userId: string, preferredWeightUnit: WeightUnit): Promise<void> {
    await this.pool.query(
      `insert into user_profiles (id, user_id, preferred_weight_unit)
       values ($1, $2, $3)
       on conflict (user_id) do update
       set preferred_weight_unit = excluded.preferred_weight_unit`,
      [id("profile"), userId, preferredWeightUnit]
    );
  }

  async profile(userId: string): Promise<{ preferredWeightUnit: WeightUnit; displayName: string | null }> {
    const result = await this.pool.query<{ preferred_weight_unit: WeightUnit; display_name: string | null }>(
      `select preferred_weight_unit, display_name from user_profiles where user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("Profile not found", "PROFILE_REQUIRED");
    return { preferredWeightUnit: row.preferred_weight_unit, displayName: row.display_name };
  }

  async createRoutine(userId: string): Promise<string> {
    const routineId = id("routine");
    const upperTemplateId = id("template");
    const lowerTemplateId = id("template");
    const exerciseId = id("exercise");
    const lowerExerciseId = id("exercise");
    await this.pool.query("begin");
    try {
      await this.pool.query(`insert into routines (id, user_id, name) values ($1, $2, 'Upper Lower')`, [
        routineId,
        userId
      ]);
      await this.pool.query(
        `insert into exercise_identities (id, owner_user_id, display_name, default_load_semantics)
         values ($1, $2, 'Incline Dumbbell Press', 'PER_HAND_PER_SIDE'), ($3, $2, 'Squat', 'UNSPECIFIED_DEFAULT')`,
        [exerciseId, userId, lowerExerciseId]
      );
      await this.pool.query(
        `insert into workout_session_templates (id, routine_id, name, sequence_index)
         values ($1, $3, 'Upper', 0), ($2, $3, 'Lower', 1)`,
        [upperTemplateId, lowerTemplateId, routineId]
      );
      await this.pool.query(
        `insert into planned_exercises (id, session_template_id, exercise_identity_id, order_index, planned_set_count, rep_target_min, rep_target_max)
         values ($1, $2, $3, 0, 3, 8, 10), ($4, $5, $6, 0, 3, 5, 5)`,
        [id("planned"), upperTemplateId, exerciseId, id("planned"), lowerTemplateId, lowerExerciseId]
      );
      await this.pool.query(
        `insert into routine_sequence_cursors (id, routine_id, user_id, next_session_template_id, cursor_sequence_index)
         values ($1, $2, $3, $4, 0)`,
        [id("cursor"), routineId, userId, upperTemplateId]
      );
      await this.pool.query("commit");
      return routineId;
    } catch (error) {
      await this.pool.query("rollback");
      throw error;
    }
  }

  async createLinkToken(userId: string): Promise<string> {
    const raw = token();
    await this.pool.query(
      `insert into account_link_tokens (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '10 minutes')`,
      [id("linktoken"), userId, sha256(raw)]
    );
    return raw;
  }

  async processInbound(message: NormalizedWhatsAppMessage, options: { crashAfterCommandBeforeOutbound?: boolean } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inbound = await this.upsertInbound(client, message);
      if (inbound.processing_status === "COMPLETED") {
        if (inbound.user_id) {
          await client.query("select pg_advisory_xact_lock(hashtext($1))", [inbound.user_id]);
          const user = (await client.query("select deleted_at,data_control_generation from users where id=$1", [inbound.user_id])).rows[0];
          if (!user || user.deleted_at) throw new DomainError("User unavailable", "UNAUTHORIZED");
          const generation = (await client.query("select data_control_generation from inbound_messages where id=$1", [inbound.id])).rows[0].data_control_generation;
          if (generation !== user.data_control_generation) { await client.query("commit"); return { reused: true, body: "Previous workout data is no longer available." }; }
          const outbound = await client.query(`select id from outbound_messages where inbound_message_id = $1`, [
            inbound.id
          ]);
          if (!outbound.rows[0]) {
            await this.persistOutbound(client, inbound.user_id, inbound.id, message, inbound.result_body ?? "Recovered previous result");
          }
        }
        await client.query("commit");
        return { reused: true, body: inbound.result_body ?? "Recovered previous result" };
      }
      const userId = await this.resolveUser(client, message);
      await client.query(`update inbound_messages set processing_status = 'PROCESSING', user_id = $2 where id = $1`, [
        inbound.id,
        userId
      ]);
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [userId]);
      if (!(await client.query("select id from users where id=$1 and deleted_at is null", [userId])).rows.length) throw new DomainError("User unavailable", "UNAUTHORIZED");
      const body = await this.applyMessage(client, userId, inbound.id, message.text);
      await client.query(`update inbound_messages set processing_status = 'COMPLETED', processed_at = now(), result_body=$2,data_control_generation=(select data_control_generation from users where id=$3) where id = $1`, [
        inbound.id, body, userId
      ]);
      if (!options.crashAfterCommandBeforeOutbound) {
        await this.persistOutbound(client, userId, inbound.id, message, body);
      }
      await client.query("commit");
      return { reused: false, body };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async history(userId: string): Promise<PgHistoryEntry[]> {
    const workouts = await this.pool.query<{ id: string; status: string; name: string; durationSeconds: number | null; trainedAt: Date }>(
      `select id, status, name, duration_seconds as "durationSeconds",coalesce(started_at,created_at) as "trainedAt" from workout_sessions where user_id = $1 and status in ('COMPLETED', 'INCOMPLETE') order by created_at`,
      [userId]
    );
    const entries: PgHistoryEntry[] = [];
    for (const workout of workouts.rows) {
      const sets = await this.pool.query<{
        load_value: string;
        weight_unit: WeightUnit;
        load_semantics: LoadSemantics;
        reps: number;
        set_index: number;
      }>(
        `select load_value, weight_unit, load_semantics, reps, set_index
         from workout_sets where workout_session_id = $1 and user_id=$2 and status='RECORDED' order by created_at,set_index`,
        [workout.id, userId]
      );
      entries.push({
        workout,
        sets: sets.rows.map((set) => ({
          loadValue: Number(set.load_value),
          weightUnit: set.weight_unit,
          loadSemantics: set.load_semantics,
          reps: set.reps,
          setIndex: set.set_index
        }))
      });
    }
    return entries;
  }

  async historyDetails(sessionToken: string, workoutId: string): Promise<EditableHistory> {
    const userId = await this.currentUser(sessionToken);
    const workout = (await this.pool.query("select id,name,status,version from workout_sessions where id=$1 and user_id=$2 and status in ('COMPLETED','INCOMPLETE')", [workoutId, userId])).rows[0];
    if (!workout) throw new DomainError("Workout not found", "NOT_FOUND");
    const sets = await this.pool.query("select s.id,coalesce(se.exercise_name_snapshot,e.display_name) as display_name,s.set_index,s.load_value,s.weight_unit,s.load_semantics,s.reps from workout_sets s join session_exercises se on se.id=s.session_exercise_id join exercise_identities e on e.id=s.exercise_identity_id where s.workout_session_id=$1 and s.user_id=$2 and s.status='RECORDED' order by s.created_at,s.set_index", [workoutId, userId]);
    const exercises = await this.pool.query("select se.id,se.exercise_identity_id as \"exerciseIdentityId\",coalesce(se.exercise_name_snapshot,e.display_name) as name,se.status,se.order_index as \"orderIndex\",se.planned_set_count_snapshot as \"plannedSets\",se.rep_target_min_snapshot as \"repTargetMin\",se.rep_target_max_snapshot as \"repTargetMax\" from session_exercises se join exercise_identities e on e.id=se.exercise_identity_id where se.workout_session_id=$1 order by se.order_index", [workoutId]);
    const client = await this.pool.connect();
    try {
      const summary = await new WorkoutLifecycle(client, userId).summary(workoutId);
      return { workout, exercises: exercises.rows, summary, sets: sets.rows.map(row => ({ id: row.id, exerciseName: row.display_name, setIndex: row.set_index, loadValue: Number(row.load_value), weightUnit: row.weight_unit, loadSemantics: row.load_semantics, reps: row.reps })) };
    } finally { client.release(); }
  }

  async editHistorySet(input: { sessionToken: string; workoutId: string; setId: string; replacement: Partial<SetInput>; idempotencyKey: string; expectedVersion: number }): Promise<string> {
    const replacement = SetInputSchema.parse(input.replacement) as Partial<SetInput>;
    const userId = await this.currentUser(input.sessionToken);
    const client = await this.pool.connect();
    try {
      await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
      if (!(await client.query("select id from users where id=$1 and deleted_at is null", [userId])).rows.length) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
      const target = (await client.query("select w.version from workout_sets s join workout_sessions w on w.id=s.workout_session_id where s.id=$1 and s.workout_session_id=$2 and s.user_id=$3 and w.user_id=$3 and w.status in ('COMPLETED','INCOMPLETE') and s.status='RECORDED'", [input.setId, input.workoutId, userId])).rows[0];
      if (!target) throw new DomainError("Set not found", "NOT_FOUND");
      const key = `web:${input.workoutId}:${input.setId}:${input.idempotencyKey}`;
      const prior = await client.query("select id from command_executions where user_id=$1 and idempotency_key=$2", [userId, key]);
      if (!prior.rows.length && target.version !== input.expectedVersion) throw new DomainError("Workout changed. Refresh before editing.", "STALE_VERSION");
      const body = await new Us4Commands(client, userId, null, "WEB").dispatch({ type: "CORRECT_SET", targetRef: input.setId, replacement }, "", key);
      if (!(await client.query("select id from command_executions where user_id=$1 and idempotency_key=$2 and status='COMPLETED'", [userId, key])).rows.length) throw new DomainError("Invalid correction", "INVALID_INPUT");
      await client.query("commit"); return body;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async activeWorkout(userId: string): Promise<{ id: string; status: string; name: string } | null> {
    const result = await this.pool.query<{ id: string; status: string; name: string }>(
      `select id, status, name from workout_sessions where user_id = $1 and status in ('PROPOSED', 'ACTIVE', 'PAUSED') limit 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  }

  async previousPerformance(userId: string, exerciseRef: string, weightUnit: WeightUnit, loadSemantics: LoadSemantics) {
    return new WorkoutHistoryQueries(this.pool).previous(userId, exerciseRef, weightUnit, loadSemantics);
  }

  private async analyticsSnapshot(sessionToken: string, now = new Date()): Promise<HistorySnapshot> {
    const userId = await this.currentUser(sessionToken), client = await this.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const snapshot = await new AnalyticsQueries(client, userId).snapshot(now);
      await client.query("commit"); return snapshot;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async analytics(sessionToken: string, now = new Date()) {
    const snapshot = await this.analyticsSnapshot(sessionToken, now);
    return { ...workoutAnalytics(snapshot), identities: snapshot.identities, classifications: snapshot.classifications };
  }

  async exerciseAnalytics(sessionToken: string, exerciseId: string) {
    const snapshot = await this.analyticsSnapshot(sessionToken);
    const identity = snapshot.identities.find(row => row.id === exerciseId);
    if (!identity) throw new DomainError("Exercise not found", "NOT_FOUND");
    return { identity, progression: workoutAnalytics(snapshot).progression.filter(row => row.exerciseIdentityId === exerciseId),
      best: answerHistoryQuestion(snapshot, { type: "QUERY_HISTORY", queryKind: "BEST_SET", subject: { kind: "EXERCISE", exerciseRef: exerciseId } }) };
  }

  async answerQuestion(sessionToken: string, value: unknown, now = new Date()): Promise<string> {
    const snapshot = await this.analyticsSnapshot(sessionToken, now);
    const action = ProposedActionSchema.parse(value);
    if (!["QUERY_HISTORY", "QUERY_ANALYTICS", "UNKNOWN"].includes(action.type)) throw new DomainError("Unsupported question", "INVALID_INPUT");
    return answerHistoryQuestion(snapshot, action as HistoryAction);
  }

  async classifyExercise(sessionToken: string, exerciseId: string, input: unknown): Promise<void> {
    const userId = await this.currentUser(sessionToken), client = await this.pool.connect();
    try {
      await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
      if (!(await client.query("select id from users where id=$1 and deleted_at is null", [userId])).rows.length) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
      await new AnalyticsQueries(client, userId).classify(exerciseId, input);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async personalRecords(userId: string, exerciseRef: string, weightUnit: WeightUnit, loadSemantics: LoadSemantics) {
    return new WorkoutHistoryQueries(this.pool).records(userId, exerciseRef, weightUnit, loadSemantics);
  }

  private async dataTransaction<T>(sessionToken: string, handler: (controls: DataControls) => Promise<T>, completedAccountRequestId?: string): Promise<T> {
    const client = await this.pool.connect(), sessionHash = sha256(sessionToken);
    try {
      await client.query("begin");
      const session = (await client.query("select user_id from auth_sessions where token_hash=$1 and expires_at>clock_timestamp()", [sessionHash])).rows[0];
      if (!session) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [session.user_id]);
      const active = (await client.query("select u.id from users u join auth_sessions s on s.user_id=u.id where u.id=$1 and u.deleted_at is null and s.token_hash=$2 and s.invalidated_at is null and s.expires_at>clock_timestamp()", [session.user_id, sessionHash])).rows[0];
      if (!active) {
        // A former session is only a receipt for its already-completed account deletion.
        const receipt = completedAccountRequestId && (await client.query("select r.id from data_control_requests r join users u on u.id=r.user_id where r.id=$1 and r.user_id=$2 and r.creator_session_hash=$3 and r.type='DELETE_ACCOUNT' and r.status='COMPLETED' and u.deleted_at is not null", [completedAccountRequestId, session.user_id, sessionHash])).rows[0];
        if (!receipt) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
      }
      const result = await handler(new DataControls(client, session.user_id, sessionHash));
      await client.query("commit"); return result;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
  async dataReview(sessionToken: string) { return this.dataTransaction(sessionToken, controls => controls.review()); }
  async requestExport(sessionToken: string, input: unknown) {
    const value = exportRequestSchema.parse(input); return this.dataTransaction(sessionToken, controls => controls.request("EXPORT", value.idempotencyKey));
  }
  async exportResult(sessionToken: string, requestId: string) { return this.dataTransaction(sessionToken, controls => controls.exportResult(requestId)); }
  async requestDeletion(sessionToken: string, input: unknown) {
    const value = deleteRequestSchema.parse(input); return this.dataTransaction(sessionToken, controls => controls.request(value.type, value.idempotencyKey));
  }
  async confirmDeletion(sessionToken: string, requestId: string, input: unknown) {
    confirmDeletionSchema.parse(input); return this.dataTransaction(sessionToken, controls => controls.confirm(requestId), requestId);
  }

  async workoutLifecycle(input: { sessionToken: string; workoutId: string; intent: CompletionIntent | "REQUEST" | "RESUME"; idempotencyKey: string }) {
    const userId = await this.currentUser(input.sessionToken);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
      if (!(await client.query("select id from users where id=$1 and deleted_at is null", [userId])).rows.length) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
      if (!(await client.query("select id from workout_sessions where id=$1 and user_id=$2 and data_deleted_at is null", [input.workoutId, userId])).rows.length) throw new DomainError("Workout not found", "NOT_FOUND");
      const lifecycle = new WorkoutLifecycle(client, userId, "WEB");
      const body = input.intent === "RESUME" ? await lifecycle.resume(input.workoutId)
        : await lifecycle.finish(`web:${input.workoutId}:finish:${input.idempotencyKey}`, input.intent, input.workoutId);
      await client.query("commit"); return { body };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async startNextWorkout(userId: string): Promise<{ id: string; status: string; name: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [userId]);
      await this.startWorkout(client, userId);
      await client.query("commit");
      return this.activeWorkout(userId);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertInbound(client: PoolClient, message: NormalizedWhatsAppMessage) {
    const result = await client.query<{
      id: string;
      processing_status: string;
      user_id: string | null;
      result_body: string | null;
    }>(
      `insert into inbound_messages
       (id, provider, provider_account_id, provider_message_id, provider_user_identity_hash, text_redacted, raw_payload_hash, processing_status)
       values ($1, $2, $3, $4, $5, $6, $7, 'RECEIVED')
       on conflict (provider_account_id, provider_message_id) do update
       set provider_message_id = excluded.provider_message_id
       returning id, processing_status, user_id, result_body`,
      [
        id("inbound"),
        message.provider,
        message.providerAccountId,
        message.providerMessageId,
        message.providerUserIdentityHash,
        "[redacted]",
        message.rawPayloadHash
      ]
    );
    return result.rows[0]!;
  }

  private async resolveUser(client: PoolClient, message: NormalizedWhatsAppMessage): Promise<string> {
    const linked = await client.query<{ user_id: string }>(
      `select l.user_id
       from whatsapp_provider_accounts a
       join whatsapp_provider_user_identities i on i.whatsapp_provider_account_id = a.id
       join whatsapp_identity_links l on l.whatsapp_provider_user_identity_id = i.id and l.revoked_at is null
       where a.provider_account_id = $1 and i.provider_user_identity_hash = $2`,
      [message.providerAccountId, message.providerUserIdentityHash]
    );
    if (linked.rows[0]) return linked.rows[0].user_id;
    const tokenMatch = message.text.match(/(?:^|\s)link\s+([A-Za-z0-9_-]+)/i);
    if (!tokenMatch?.[1]) throw new DomainError("Unlinked identity", "UNLINKED_IDENTITY");
    const tokenHash = sha256(tokenMatch[1]);
    const tokenResult = await client.query<{ id: string; user_id: string }>(
      `select id, user_id from account_link_tokens
       where token_hash = $1 and consumed_at is null and expires_at > now()
       for update`,
      [tokenHash]
    );
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) throw new DomainError("Invalid link token", "INVALID_LINK_TOKEN");
    const accountId = id("wap");
    await client.query(
      `insert into whatsapp_provider_accounts (id, provider, provider_account_id)
       values ($1, 'WHATSAPP_CLOUD_API', $2)
       on conflict (provider, provider_account_id) do nothing`,
      [accountId, message.providerAccountId]
    );
    const account = await client.query<{ id: string }>(
      `select id from whatsapp_provider_accounts where provider = 'WHATSAPP_CLOUD_API' and provider_account_id = $1`,
      [message.providerAccountId]
    );
    const identityId = id("wpi");
    await client.query(
      `insert into whatsapp_provider_user_identities (id, whatsapp_provider_account_id, provider_user_identity_hash)
       values ($1, $2, $3)
       on conflict (whatsapp_provider_account_id, provider_user_identity_hash) do nothing`,
      [identityId, account.rows[0]!.id, message.providerUserIdentityHash]
    );
    const identity = await client.query<{ id: string }>(
      `select id from whatsapp_provider_user_identities where whatsapp_provider_account_id = $1 and provider_user_identity_hash = $2`,
      [account.rows[0]!.id, message.providerUserIdentityHash]
    );
    await client.query(
      `insert into whatsapp_identity_links (id, user_id, whatsapp_provider_user_identity_id, linked_at)
       values ($1, $2, $3, now())`,
      [id("walink"), tokenRow.user_id, identity.rows[0]!.id]
    );
    await client.query(`update account_link_tokens set consumed_at = now() where id = $1`, [tokenRow.id]);
    return tokenRow.user_id;
  }

  private async applyMessage(client: PoolClient, userId: string, inboundId: string, text: string): Promise<string> {
    const lower = text.trim().toLowerCase();
    if (lower.startsWith("link ")) return "WhatsApp linked";
    const us4 = new Us4Commands(client, userId, inboundId);
    const us4Result = await handleDeterministicUs4Message(text, `${inboundId}:us4`, us4);
    const lifecycle = new WorkoutLifecycle(client, userId);
    const withContext = async (body: string) => {
      const context = /^(Changed active exercise|Change today only|Log sets for confirmed exercise|Create custom exercise).*applied\.$/.test(body) ? await lifecycle.context() : "";
      return context ? `${body}\n${context}` : body;
    };
    if (us4Result !== undefined) return withContext(us4Result);
    if (lower === "start") {
      const active = (await client.query("select name from workout_sessions where user_id=$1 and status in ('ACTIVE','PAUSED','PROPOSED')", [userId])).rows[0];
      if (active) return `${active.name} is already active. Resume, finish, save incomplete, discard, or replace?`;
      await this.startWorkout(client, userId);
      return `Started workout\n${await lifecycle.context()}`.trim();
    }
    if (isResumeIntent(text)) return lifecycle.resume();
    const completion = parseCompletionIntent(text);
    if (completion) return lifecycle.finish(`${inboundId}:finish`, completion);
    if (isCoachingQuestion(text)) return coachingBoundary;
    const question = parseHistoryQuestion(text);
    if (question) return answerHistoryQuestion(await new AnalyticsQueries(client, userId).snapshot(), question);
    const commandKey = `${inboundId}:log`;
    const existing = await client.query(
      `select id from command_executions where user_id = $1 and idempotency_key = $2 and status = 'COMPLETED'`,
      [userId, commandKey]
    );
    if (existing.rows[0]) return "Logged set";
    try {
      await this.logSets(client, userId, inboundId, commandKey, text);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NO_SET_NOTATION" || !this.interpreter) throw error;
      const activeContext = await client.query("select w.id,e.display_name from workout_sessions w left join session_exercises se on se.id=w.active_session_exercise_id left join exercise_identities e on e.id=se.exercise_identity_id where w.user_id = $1 and w.status = 'ACTIVE'", [userId]);
      const known = await client.query("select display_name from exercise_identities where (owner_user_id=$1 or owner_user_id is null) and merged_into_id is null", [userId]);
      const aliases = await client.query("select a.alias_text,e.display_name from exercise_aliases a join exercise_identities e on e.id=a.exercise_identity_id where a.user_id=$1 and a.status='CONFIRMED' and e.merged_into_id is null", [userId]);
      const envelope = await this.interpreter.interpret({
        userInput: text, idempotencyKey: commandKey, context: { userId, activeWorkout: activeContext.rows.length > 0, ...(activeContext.rows[0]?.display_name ? { activeExercise: activeContext.rows[0].display_name } : {}), knownExerciseRefs: known.rows.map(row => row.display_name), confirmedAliases: aliases.rows.map(row => ({ alias: row.alias_text, exerciseRef: row.display_name })) }
      });
      const validated = parseProposedActionEnvelope(envelope);
      if (validated.requiresClarification && (validated.action.type === "QUERY_HISTORY" || validated.action.type === "QUERY_ANALYTICS")) return "Which exact exercise, workout session or muscle do you mean?";
      if (validated.requiresClarification) return validated.clarificationQuestion ?? "Please clarify the request.";
      if (validated.action.type === "QUERY_HISTORY" || validated.action.type === "QUERY_ANALYTICS") return answerHistoryQuestion(await new AnalyticsQueries(client, userId).snapshot(), validated.action);
      if (validated.action.type === "UNKNOWN") return coachingBoundary;
      if (validated.action.type === "RESUME_WORKOUT") return lifecycle.resume(validated.action.workoutRef);
      if (validated.action.type === "FINISH_WORKOUT") {
        // A model-supplied completion choice is not evidence of explicit user consent.
        const choice = parseCompletionIntent(text);
        return lifecycle.finish(`${inboundId}:finish`, choice ?? "REQUEST");
      }
      return withContext(await us4.dispatchEnvelope(validated, text, `${inboundId}:us4`));
    }
    return "Logged set";
  }

  private async startWorkout(client: PoolClient, userId: string): Promise<void> {
    if (!(await client.query("select id from users where id=$1 and deleted_at is null", [userId])).rows.length) throw new DomainError("User unavailable", "UNAUTHORIZED");
    const active = await client.query(`select id from workout_sessions where user_id = $1 and status in ('PROPOSED', 'ACTIVE', 'PAUSED')`, [
      userId
    ]);
    if (active.rows[0]) return;
    const cursor = await client.query<{ routine_id: string; next_session_template_id: string }>(
      `select routine_id, next_session_template_id from routine_sequence_cursors where user_id = $1 limit 1`,
      [userId]
    );
    const row = cursor.rows[0];
    if (!row) throw new DomainError("No routine", "NO_ROUTINE");
    const template = await client.query<{ name: string }>(`select name from workout_session_templates where id = $1`, [
      row.next_session_template_id
    ]);
    const workoutId = id("workout");
    const planned = await client.query<{
      id: string;
      exercise_identity_id: string;
      order_index: number;
      planned_set_count: number;
      rep_target_min: number;
      rep_target_max: number;
    }>(
      `select * from planned_exercises where session_template_id = $1 and removed_at is null order by order_index`,
      [row.next_session_template_id]
    );
    await client.query(
      `insert into workout_sessions
       (id, user_id, routine_id, session_template_id, template_snapshot, name, status, sequence_progression_policy, started_at)
       values ($1, $2, $3, $4, $5, $6, 'ACTIVE', 'ADVANCE_NORMAL_SEQUENCE', now())`,
      [workoutId, userId, row.routine_id, row.next_session_template_id, JSON.stringify(planned.rows), template.rows[0]!.name]
    );
    for (const plannedExercise of planned.rows) {
      const sessionExerciseId = id("sexercise");
      await client.query(
        `insert into session_exercises
         (id, workout_session_id, exercise_identity_id, source_planned_exercise_id, order_index, status, planned_set_count_snapshot, rep_target_min_snapshot, rep_target_max_snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          sessionExerciseId,
          workoutId,
          plannedExercise.exercise_identity_id,
          plannedExercise.id,
          plannedExercise.order_index,
          plannedExercise.order_index === planned.rows[0]?.order_index ? "IN_PROGRESS" : "PLANNED",
          plannedExercise.planned_set_count,
          plannedExercise.rep_target_min,
          plannedExercise.rep_target_max
        ]
      );
      if (plannedExercise.order_index === planned.rows[0]?.order_index) {
        await client.query(`update workout_sessions set active_session_exercise_id = $1 where id = $2`, [
          sessionExerciseId,
          workoutId
        ]);
      }
    }
    await client.query("update session_exercises se set exercise_name_snapshot=e.display_name from exercise_identities e where se.exercise_identity_id=e.id and se.workout_session_id=$1", [workoutId]);
  }

  private async logSets(client: PoolClient, userId: string, inboundId: string, commandKey: string, text: string): Promise<void> {
    if (!hasSetNotation(text)) throw new DomainError("No deterministic set notation", "NO_SET_NOTATION");
    const workout = await client.query<{ id: string; active_session_exercise_id: string }>(
      `select id, active_session_exercise_id from workout_sessions where user_id = $1 and status = 'ACTIVE'`,
      [userId]
    );
    const active = workout.rows[0];
    if (!active) throw new DomainError("No active workout", "NO_ACTIVE_WORKOUT");
    if (!active.active_session_exercise_id) throw new DomainError("Choose an active exercise", "EXERCISE_REQUIRED");
    const exercise = await client.query<{ exercise_identity_id: string; default_load_semantics: LoadSemantics }>(
      `select se.exercise_identity_id, e.default_load_semantics
       from session_exercises se join exercise_identities e on e.id = se.exercise_identity_id
       where se.id = $1`,
      [active.active_session_exercise_id]
    );
    const profile = await client.query<{ preferred_weight_unit: WeightUnit }>(
      `select preferred_weight_unit from user_profiles where user_id = $1`,
      [userId]
    );
    const previous = await client.query<{ load_value: string; weight_unit: WeightUnit; load_semantics: LoadSemantics }>(
      `select load_value, weight_unit, load_semantics from workout_sets where session_exercise_id = $1 and status='RECORDED' order by set_index desc limit 1`,
      [active.active_session_exercise_id]
    );
    const parsed = parseSetMessage(text, {
      preferredWeightUnit: profile.rows[0]!.preferred_weight_unit,
      exerciseDefaultLoadSemantics: exercise.rows[0]!.default_load_semantics,
      ...(previous.rows[0]
        ? {
            previousSet: {
              loadValue: Number(previous.rows[0].load_value),
              weightUnit: previous.rows[0].weight_unit,
              loadSemantics: previous.rows[0].load_semantics
            }
          }
        : {})
    });
    await client.query(
      `insert into command_executions (id, user_id, command_type, idempotency_key, status, result_summary, applied_at)
       values ($1, $2, 'LOG_SET', $3, 'COMPLETED', '{"body":"Logged set"}'::jsonb, now())
       on conflict (user_id, idempotency_key) do nothing`,
      [id("cmd"), userId, commandKey]
    );
    for (const parsedSet of parsed) {
      const count = await client.query<{ count: string }>(
        `select coalesce(max(set_index),0)::text as count from workout_sets where session_exercise_id = $1`,
        [active.active_session_exercise_id]
      );
      const setIndex = Number(count.rows[0]!.count) + 1;
      await client.query(
        `insert into workout_sets
         (id, user_id, workout_session_id, session_exercise_id, exercise_identity_id, set_index, load_value, weight_unit, load_semantics, reps, status, idempotency_key, source_message_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'RECORDED', $11, $12)
         on conflict (user_id, idempotency_key) do nothing`,
        [
          id("set"),
          userId,
          active.id,
          active.active_session_exercise_id,
          exercise.rows[0]!.exercise_identity_id,
          setIndex,
          parsedSet.loadValue,
          parsedSet.weightUnit,
          parsedSet.loadSemantics,
          parsedSet.reps,
          `${commandKey}:${setIndex}`,
          inboundId
        ]
      );
    }
    await client.query("update workout_sessions set version=version+1 where id=$1 and user_id=$2", [active.id, userId]);
  }

  private async persistOutbound(
    client: PoolClient,
    userId: string,
    inboundId: string,
    message: NormalizedWhatsAppMessage,
    body: string
  ): Promise<void> {
    const outboundId = id("outbound");
    await client.query(
      `insert into outbound_messages
       (id, user_id, inbound_message_id, provider_account_id, provider_user_identity_hash, body_hash, body, status, sent_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'SENT', now())
       on conflict do nothing`,
      [outboundId, userId, inboundId, message.providerAccountId, message.providerUserIdentityHash, sha256(body), body]
    );
    await client.query(`update inbound_messages set outbound_message_id = $1 where id = $2 and outbound_message_id is null`, [
      outboundId,
      inboundId
    ]);
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function token(): string {
  return randomBytes(18).toString("base64url");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
