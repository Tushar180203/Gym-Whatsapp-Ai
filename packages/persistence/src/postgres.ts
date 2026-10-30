import { formatWhatsAppMessage } from "../../domain/src/messaging/response-layout.js";
import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
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
import type { SafeEvent } from "../../domain/src/observability/events.js";
import { Configuration } from "./configuration.js";
import { WorkoutSelection } from "./workout-selection.js";
import { parseStartIntent, type StartChoice } from "../../domain/src/workouts/start-intent.js";
import { isCoachingQuestion, parseHistoryQuestion } from "../../domain/src/messaging/history-query-parser.js";
import { z } from "zod";
import { linkRequestSchema, parseLinkCommand } from "../../messaging/src/whatsapp/link-challenge.js";
import { WhatsAppLinks, verifyWhatsAppChallenge, queuePlanReady, type VerifiedRecipientWriter } from "./whatsapp-links.js";
import { ConversationOrchestrator } from "../../domain/src/conversation/orchestrator.js";
import { PostgresConversation } from "./conversation.js";
import { ConversationMemory } from "./conversation-memory.js";

export type PostgresSliceConfig = {
  connectionString: string;
  interpreter?: IntentInterpreter;
  observe?: (event: SafeEvent) => void;
  checkInboundLimit?: (key: string) => void;
  checkAiLimit?: (key: string) => void;
  checkLinkLimit?: (key: string) => void;
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
  private readonly config: PostgresSliceConfig;

  constructor(config: PostgresSliceConfig) {
    this.pool = new Pool({ connectionString: config.connectionString });
    this.interpreter = config.interpreter;
    this.config = config;
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
      for (const name of ["0001_vertical_slice.sql", "0002_us4.sql", "0003_us5.sql", "0004_us6.sql", "0005_us7.sql", "0006_release_integrity.sql", "0007_core_configuration.sql", "0008_whatsapp_transport.sql", "0009_whatsapp_ownership.sql", "0010_conversation.sql", "0011_conversation_memory.sql", "0012_workout_reminders.sql"]) {
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
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into users (id, email, password_hash) values ($1, $2, $3)`,
        [userId, email.toLowerCase(), hashPassword(password)]
      );
      await client.query(
        `insert into auth_sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`,
        [sessionId, userId, sha256(sessionToken)]
      );
      await client.query("commit");
      return { userId, sessionToken };
    } catch (error) {
      await client.query("rollback");
      if (error instanceof Error && "code" in error && error.code === "23505" && "constraint" in error && error.constraint === "active_user_email") {
        throw new DomainError("Account could not be created", "SIGNUP_UNAVAILABLE");
      }
      throw error;
    } finally { client.release(); }
  }

  async signIn(email: string, password: string): Promise<{ userId: string; sessionToken: string }> {
    const row = (await this.pool.query<{ id: string; password_hash: string }>(
      `select id, password_hash from users where email = $1 and deleted_at is null`, [email.trim().toLowerCase()]
    )).rows[0];
    // Hash against a throwaway value for unknown emails so response time does not reveal which accounts exist.
    const valid = verifyPassword(password, row?.password_hash ?? hashPassword("unknown-account-placeholder"));
    if (!row || !valid) throw new DomainError("Invalid credentials", "INVALID_CREDENTIALS");
    const sessionToken = token();
    await this.pool.query(
      `insert into auth_sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`,
      [id("session"), row.id, sha256(sessionToken)]
    );
    return { userId: row.id, sessionToken };
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

  async profile(userId: string): Promise<{ preferredWeightUnit: WeightUnit; displayName: string | null; timeZone: string; conversationMemoryEnabled: boolean; workoutRemindersEnabled: boolean }> {
    const result = await this.pool.query<{ preferred_weight_unit: WeightUnit; display_name: string | null; time_zone: string; conversation_memory_enabled: boolean; workout_reminders_enabled: boolean }>(
      `select preferred_weight_unit, display_name, time_zone, conversation_memory_enabled, workout_reminders_enabled from user_profiles where user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("Profile not found", "PROFILE_REQUIRED");
    return { preferredWeightUnit: row.preferred_weight_unit, displayName: row.display_name, timeZone: row.time_zone, conversationMemoryEnabled: row.conversation_memory_enabled, workoutRemindersEnabled: row.workout_reminders_enabled };
  }

  async configure<T>(sessionToken: string, handler: (configuration: Configuration) => Promise<T>): Promise<T> {
    return this.ownerTransaction(sessionToken, (client, userId) => handler(new Configuration(client, userId)));
  }

  private async ownerTransaction<T>(sessionToken: string, handler: (client: PoolClient, userId: string) => Promise<T>): Promise<T> {
    const userId = await this.currentUser(sessionToken), client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
      if (!(await client.query("select u.id from users u join auth_sessions s on s.user_id=u.id where u.id=$1 and u.deleted_at is null and s.token_hash=$2 and s.invalidated_at is null and s.expires_at>clock_timestamp()", [userId, sha256(sessionToken)])).rows.length) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
      const result = await handler(client, userId);
      await client.query("commit"); return result;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async recordWebSets(sessionToken: string, workoutId: string, input: unknown) {
    const value = z.object({ notation: z.string().min(1).max(8192), expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(1).max(160) }).strict().parse(input);
    return this.ownerTransaction(sessionToken, async (client, userId) => {
      const workout = (await client.query("select id,version,status from workout_sessions where id=$1 and user_id=$2 and data_deleted_at is null", [workoutId, userId])).rows[0];
      if (!workout) throw new DomainError("Workout not found", "NOT_FOUND");
      const key = `web:sets:${workoutId}:${value.idempotencyKey}`;
      if ((await client.query("select id from command_executions where user_id=$1 and idempotency_key=$2 and status='COMPLETED'", [userId, key])).rows.length) return { body: "Logged set", reused: true };
      if (workout.status !== "ACTIVE") throw new DomainError("Workout is not active", "NO_ACTIVE_WORKOUT");
      if (workout.version !== value.expectedVersion) throw new DomainError("Workout changed", "STALE_VERSION");
      await this.logSets(client, userId, null, key, value.notation);
      return { body: "Logged set", reused: false };
    });
  }

  async deleteWebSet(sessionToken: string, workoutId: string, setId: string, input: unknown) {
    const value = z.object({ expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(1).max(160), confirmationId: z.string().optional(), confirm: z.literal(true).optional() }).strict().parse(input);
    return this.ownerTransaction(sessionToken, async (client, userId) => {
      const target = (await client.query("select s.status,w.version from workout_sets s join workout_sessions w on w.id=s.workout_session_id and w.user_id=s.user_id where s.id=$1 and s.workout_session_id=$2 and s.user_id=$3 and w.data_deleted_at is null", [setId, workoutId, userId])).rows[0];
      if (!target) throw new DomainError("Set not found", "NOT_FOUND");
      const key = `web:delete:${setId}:${value.idempotencyKey}`;
      const prior = (await client.query("select result_summary from command_executions where user_id=$1 and idempotency_key=$2 and status='COMPLETED'", [userId, key])).rows[0];
      if (prior) return prior.result_summary;
      const commands = new Us4Commands(client, userId, null, "WEB"); let body: string;
      if (value.confirm) {
        if (!value.confirmationId || !(await client.query("select id from pending_confirmations where id=$1 and user_id=$2 and action_type='DELETE_SET' and proposed_action->'args'->>'targetId'=$3", [value.confirmationId, userId, setId])).rows.length) throw new DomainError("Confirmation not found", "NOT_FOUND");
        const latest = (await client.query("select id from pending_confirmations where user_id=$1 order by created_at desc,id desc limit 1", [userId])).rows[0];
        if (latest?.id !== value.confirmationId) throw new DomainError("Confirmation changed", "STALE_VERSION");
        body = (await commands.resolveConfirmation("confirm"))!;
      } else {
        if (target.status !== "RECORDED") throw new DomainError("Set not found", "NOT_FOUND");
        if (target.version !== value.expectedVersion) throw new DomainError("Workout changed", "STALE_VERSION");
        body = await commands.dispatch({ type: "DELETE_SET", targetRef: setId }, "delete this set", `${key}:request`);
      }
      const pending = (await client.query("select id from pending_confirmations where user_id=$1 and action_type='DELETE_SET' and status='PENDING' and proposed_action->'args'->>'targetId'=$2", [userId, setId])).rows[0];
      const result = { body, ...(pending ? { confirmationId: pending.id } : {}) };
      await client.query("insert into command_executions(id,user_id,command_type,idempotency_key,status,result_summary,applied_at) values($1,$2,'DELETE_SET_REQUEST',$3,'COMPLETED',$4,clock_timestamp())", [randomUUID(), userId, key, JSON.stringify(result)]);
      return result;
    });
  }

  async createRoutine(userId: string): Promise<string> {
    const routineId = id("routine");
    const upperTemplateId = id("template");
    const lowerTemplateId = id("template");
    const exerciseId = id("exercise");
    const lowerExerciseId = id("exercise");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into routines (id, user_id, name) values ($1, $2, 'Upper Lower')`, [
        routineId,
        userId
      ]);
      await client.query(
        `insert into exercise_identities (id, owner_user_id, display_name, default_load_semantics)
         values ($1, $2, 'Incline Dumbbell Press', 'PER_HAND_PER_SIDE'), ($3, $2, 'Squat', 'UNSPECIFIED_DEFAULT')`,
        [exerciseId, userId, lowerExerciseId]
      );
      await client.query(
        `insert into workout_session_templates (id, routine_id, name, sequence_index)
         values ($1, $3, 'Upper', 0), ($2, $3, 'Lower', 1)`,
        [upperTemplateId, lowerTemplateId, routineId]
      );
      await client.query(
        `insert into planned_exercises (id, session_template_id, exercise_identity_id, order_index, planned_set_count, rep_target_min, rep_target_max)
         values ($1, $2, $3, 0, 3, 8, 10), ($4, $5, $6, 0, 3, 5, 5)`,
        [id("planned"), upperTemplateId, exerciseId, id("planned"), lowerTemplateId, lowerExerciseId]
      );
      await client.query(
        `insert into routine_sequence_cursors (id, routine_id, user_id, next_session_template_id, cursor_sequence_index)
         values ($1, $2, $3, $4, 0)`,
        [id("cursor"), routineId, userId, upperTemplateId]
      );
      await client.query("commit");
      return routineId;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Trusted repository fixture setup, never exposed as an unauthenticated API. */
  async createLinkToken(userId: string, expectedIdentityHash: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
      const result = await new WhatsAppLinks(client, userId).issue(expectedIdentityHash, null, false, false);
      await client.query("commit"); return result.token;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async createWebLinkToken(sessionToken: string, input: unknown) {
    const value = linkRequestSchema.parse(input);
    return this.ownerTransaction(sessionToken, async (client, userId) => {
      return new WhatsAppLinks(client, userId).issue(value.phoneNumber.identityHash, value.phoneNumber.maskedNumber, value.change, true);
    });
  }

  async processInbound(message: NormalizedWhatsAppMessage, options: { crashAfterCommandBeforeOutbound?: boolean; writeVerifiedRecipient?: VerifiedRecipientWriter } = {}) {
    this.config.checkInboundLimit?.(sha256(JSON.stringify([message.provider,message.providerAccountId,message.providerUserIdentityHash])));
    if (parseLinkCommand(message.text)) this.config.checkLinkLimit?.(sha256(JSON.stringify([message.provider,message.providerAccountId,message.providerUserIdentityHash])));
    const started = performance.now();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inbound = await this.upsertInbound(client, message);
      if (inbound.processing_status === "COMPLETED") {
        this.config.observe?.({ event: "duplicate_message" });
        if (inbound.user_id) {
          await client.query("select pg_advisory_xact_lock(hashtext($1))", [inbound.user_id]);
          const user = (await client.query("select deleted_at,data_control_generation from users where id=$1", [inbound.user_id])).rows[0];
          if (!user || user.deleted_at) throw new DomainError("User unavailable", "UNAUTHORIZED");
          if (await this.resolveUser(client, message) !== inbound.user_id) throw new DomainError("Identity unavailable", "UNAUTHORIZED");
          const verifiedLink = (await client.query("select verified_link_id from inbound_messages where id=$1", [inbound.id])).rows[0]?.verified_link_id;
          if (verifiedLink && !(await client.query("select id from whatsapp_identity_links where id=$1 and user_id=$2 and status='VERIFIED' and revoked_at is null", [verifiedLink, inbound.user_id])).rows.length) throw new DomainError("Identity unavailable", "UNAUTHORIZED");
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
        return { reused: true, body: inbound.result_body ?? "Recovered previous result", verificationRejected: !inbound.user_id };
      }
      const linkCommand = parseLinkCommand(message.text);
      const verification = linkCommand ? await verifyWhatsAppChallenge(client, message, linkCommand.code, options.writeVerifiedRecipient) : undefined;
      if (verification?.verificationRejected) {
        await client.query("update inbound_messages set processing_status='COMPLETED',processed_at=clock_timestamp(),result_body=$2 where id=$1", [inbound.id, verification.body]);
        await client.query("commit"); return { reused: false, body: verification.body, verificationRejected: true };
      }
      const userId = verification?.userId ?? await this.resolveUser(client, message);
      await client.query(`update inbound_messages set processing_status = 'PROCESSING', user_id = $2 where id = $1`, [
        inbound.id,
        userId
      ]);
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [userId]);
      if (!(await client.query("select id from users where id=$1 and deleted_at is null", [userId])).rows.length) throw new DomainError("User unavailable", "UNAUTHORIZED");
      if (!verification && await this.resolveUser(client, message) !== userId) throw new DomainError("Identity unavailable", "UNAUTHORIZED");
      await client.query(`update inbound_messages set verified_link_id=(select l.id from whatsapp_identity_links l
        join whatsapp_provider_user_identities i on i.id=l.whatsapp_provider_user_identity_id
        join whatsapp_provider_accounts a on a.id=i.whatsapp_provider_account_id
        where l.user_id=$2 and l.status='VERIFIED' and a.provider_account_id=$3 and i.provider_user_identity_hash=$4 limit 1) where id=$1`,
      [inbound.id, userId, message.providerAccountId, message.providerUserIdentityHash]);
      const body = formatWhatsAppMessage(verification?.body ?? await this.applyMessage(client, userId, inbound.id, message.text, message.providerSentAt));
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
      this.config.observe?.({ event: "processing_failure", code: error instanceof DomainError ? error.code : "PROCESSING_FAILED" });
      throw error;
    } finally {
      client.release();
      this.config.observe?.({ event: "message_latency", durationMs: performance.now() - started });
    }
  }

  async history(userId: string): Promise<PgHistoryEntry[]> {
    const workouts = await this.pool.query<{ id: string; status: string; name: string; durationSeconds: number | null; trainedAt: Date }>(
      `select id, status, name, duration_seconds as "durationSeconds",coalesce(started_at,created_at) as "trainedAt" from workout_sessions where user_id = $1 and status in ('COMPLETED', 'INCOMPLETE') order by created_at`,
      [userId]
    );
    const entries: PgHistoryEntry[] = [];
      const sets = await this.pool.query<{
        workout_session_id: string;
        load_value: string;
        weight_unit: WeightUnit;
        load_semantics: LoadSemantics;
        reps: number;
        set_index: number;
      }>(
        `select workout_session_id,load_value, weight_unit, load_semantics, reps, set_index
         from workout_sets where workout_session_id = any($1::text[]) and user_id=$2 and status='RECORDED' order by created_at,set_index`,
        [workouts.rows.map(workout => workout.id), userId]
      );
    const byWorkout = new Map<string, typeof sets.rows>();
    for (const set of sets.rows) { const rows = byWorkout.get(set.workout_session_id) ?? []; rows.push(set); byWorkout.set(set.workout_session_id, rows); }
    for (const workout of workouts.rows) {
      entries.push({
        workout,
        sets: (byWorkout.get(workout.id) ?? []).map((set) => ({
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

  async activeWorkout(userId: string): Promise<{ id: string; status: string; name: string; version: number } | null> {
    const result = await this.pool.query<{ id: string; status: string; name: string; version: number }>(
      `select id, status, name, version from workout_sessions where user_id = $1 and status in ('PROPOSED', 'ACTIVE', 'PAUSED') limit 1`,
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

  async selectWorkout(sessionToken: string, input: unknown) {
    const value = z.object({ kind: z.enum(["START", "ACCEPT", "CHOOSE", "REST", "REPLACE", "CONFIRM"]), routineRef: z.string().min(1).optional(), sessionRef: z.string().min(1).optional(), workoutId: z.string().optional(), expectedVersion: z.number().int().positive().optional(), confirmationId: z.string().optional(), idempotencyKey: z.string().min(1).max(160) }).strict().parse(input);
    const userId = await this.currentUser(sessionToken), client = await this.pool.connect();
    try {
      await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
      if (!(await client.query("select u.id from users u join auth_sessions s on s.user_id=u.id where u.id=$1 and u.deleted_at is null and s.token_hash=$2 and s.invalidated_at is null and s.expires_at>clock_timestamp()", [userId, sha256(sessionToken)])).rows.length) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
      const key = `web:selection:${value.idempotencyKey}`;
      const prior = (await client.query("select result_summary from command_executions where user_id=$1 and idempotency_key=$2 and status='COMPLETED'", [userId, key])).rows[0];
      if (prior) { await client.query("commit"); return prior.result_summary; }
      const selection = new WorkoutSelection(client, userId), commands = new Us4Commands(client, userId, null, "WEB");
      if (value.workoutId) {
        const active = await selection.active();
        if (!active || active.id !== value.workoutId) throw new DomainError("Workout not found", "NOT_FOUND");
        if (value.expectedVersion !== active.version) throw new DomainError("Workout changed", "STALE_VERSION");
      }
      let body: string;
      if (value.kind === "CONFIRM") {
        if (!value.confirmationId || !(await client.query("select id from pending_confirmations where id=$1 and user_id=$2 and action_type='REPLACE_WORKOUT'", [value.confirmationId, userId])).rows.length) throw new DomainError("Confirmation not found", "NOT_FOUND");
        const latest = (await client.query("select id from pending_confirmations where user_id=$1 order by created_at desc,id desc limit 1", [userId])).rows[0];
        if (latest?.id !== value.confirmationId) throw new DomainError("Confirmation changed", "STALE_VERSION");
        body = (await commands.resolveConfirmation("confirm"))!;
      } else if (value.kind === "REPLACE") {
        if (!value.sessionRef || !value.workoutId || value.expectedVersion === undefined) throw new DomainError("Choose the exact active workout and replacement", "INVALID_REPLACEMENT");
        body = await commands.dispatch({ type: "REPLACE_WORKOUT", sessionRef: value.sessionRef }, `replace workout with ${value.sessionRef}`, `${key}:replace`);
      } else if (value.kind === "CHOOSE") {
        if (!value.sessionRef) throw new DomainError("Choose a session", "INVALID_SELECTION");
        body = await selection.choose(value.sessionRef);
      } else if (value.kind === "ACCEPT") body = await selection.accept();
      else if (value.kind === "REST") body = await selection.rest();
      else body = await selection.start(value.routineRef, value.sessionRef);
      const workout = await selection.active();
      const pending = (await client.query("select id from pending_confirmations where user_id=$1 and status='PENDING' and action_type='REPLACE_WORKOUT'", [userId])).rows[0];
      const result = { body, workout: workout ? { id: workout.id, name: workout.name, status: workout.status, version: workout.version } : null, ...(pending ? { confirmationId: pending.id } : {}) };
      await client.query("insert into command_executions(id,user_id,command_type,idempotency_key,status,result_summary,applied_at) values($1,$2,'WORKOUT_SELECTION',$3,'COMPLETED',$4,clock_timestamp())", [randomUUID(), userId, key, JSON.stringify(result)]);
      await client.query("commit"); return result;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  private async upsertInbound(client: PoolClient, message: NormalizedWhatsAppMessage) {
    const result = await client.query<{
      id: string;
      processing_status: string;
      user_id: string | null;
      result_body: string | null;
      provider_user_identity_hash: string;
    }>(
      `insert into inbound_messages
       (id, provider, provider_account_id, provider_message_id, provider_user_identity_hash, text_redacted, raw_payload_hash, processing_status)
       values ($1, $2, $3, $4, $5, $6, $7, 'RECEIVED')
       on conflict (provider_account_id, provider_message_id) do update
       set provider_message_id = excluded.provider_message_id
       returning id, processing_status, user_id, result_body, provider_user_identity_hash`,
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
    const inbound = result.rows[0]!;
    if (inbound.provider_user_identity_hash !== message.providerUserIdentityHash) throw new DomainError("Message identity mismatch", "UNAUTHORIZED");
    return inbound;
  }

  private async resolveUser(client: PoolClient, message: NormalizedWhatsAppMessage): Promise<string> {
    const linked = await client.query<{ user_id: string }>(
      `select l.user_id
       from whatsapp_provider_accounts a
       join whatsapp_provider_user_identities i on i.whatsapp_provider_account_id = a.id
       join whatsapp_identity_links l on l.whatsapp_provider_user_identity_id = i.id and l.revoked_at is null and l.status='VERIFIED'
       where a.provider='WHATSAPP_CLOUD_API' and a.provider_account_id = $1 and i.provider_user_identity_hash = $2`,
      [message.providerAccountId, message.providerUserIdentityHash]
    );
    if (linked.rows[0]) return linked.rows[0].user_id;
    throw new DomainError("Unverified identity", "UNLINKED_IDENTITY");
  }

  private async applyMessage(client: PoolClient, userId: string, inboundId: string, text: string, eventAt?: number): Promise<string> {
    const started = performance.now();
    let ignoredOlder = false;
    const ports = new PostgresConversation(client, userId, inboundId,
      value => this.applyDeterministicMessage(client, userId, inboundId, value),
      value => this.logSets(client, userId, inboundId, `${inboundId}:log`, value), {
        ...(this.interpreter ? { interpreter: this.interpreter } : {}),
        beforeAi: () => this.config.checkAiLimit?.(userId),
        observe: trace => {
          ignoredOlder = trace.executionResult === "IGNORED_OLDER";
          this.config.observe?.({ event: "conversation_route", ...trace });
          this.config.observe?.({ event: "message_latency", path: trace.aiInvoked ? "AI" : "DETERMINISTIC", durationMs: performance.now() - started });
          if (trace.executionResult === "AI_FAILED") this.config.observe?.({ event: "ai_failure", code: "AI_FAILED" });
        }
      });
    const body = await new ConversationOrchestrator(ports).process(text, eventAt);
    const eventTime = new Date(Math.min(eventAt ?? Date.now(), Date.now()));
    if (!ignoredOlder) await new ConversationMemory(client, userId).remember(inboundId, text, body, eventTime);
    return body;
  }

  private async applyDeterministicMessage(client: PoolClient, userId: string, inboundId: string, text: string): Promise<string | undefined> {
    const lower = text.trim().toLowerCase();
    if (lower.startsWith("link ")) return "WhatsApp linked";
    const us4 = new Us4Commands(client, userId, inboundId);
    const choice = parseStartIntent(text);
    if (choice) {
      const selection = new WorkoutSelection(client, userId);
      if (choice.kind === "REPLACE") return us4.dispatch({ type: "REPLACE_WORKOUT", sessionRef: choice.sessionRef }, text, `${inboundId}:replace`);
      return this.applyStartChoice(selection, choice);
    }
    const us4Result = await handleDeterministicUs4Message(text, `${inboundId}:us4`, us4);
    const lifecycle = new WorkoutLifecycle(client, userId);
    const withContext = async (body: string) => {
      const context = /^(Changed active exercise|Change today only|Log sets for confirmed exercise|Create custom exercise).*applied\.$/.test(body) ? await lifecycle.context() : "";
      return context ? `${body}\n${context}` : body;
    };
    if (us4Result !== undefined) return withContext(us4Result);
    if (isResumeIntent(text)) return lifecycle.resume();
    const completion = parseCompletionIntent(text);
    if (completion) return lifecycle.finish(`${inboundId}:finish`, completion);
    if (isCoachingQuestion(text)) return coachingBoundary;
    const question = parseHistoryQuestion(text);
    if (question) return answerHistoryQuestion(await new AnalyticsQueries(client, userId).snapshot(), question);
    const commandKey = `${inboundId}:log`;
    // The deterministic logger is an intentional fast path only. Natural
    // language must reach the contextual interpreter instead of being turned
    // into a parser error here.
    if (!hasSetNotation(text)) return undefined;
    const existing = await client.query(
      `select id from command_executions where user_id = $1 and idempotency_key = $2 and status = 'COMPLETED'`,
      [userId, commandKey]
    );
    if (existing.rows[0]) return "Logged set";
    try {
      await this.logSets(client, userId, inboundId, commandKey, text);
    } catch (error) {
      if (error instanceof DomainError && error.code === "NO_SET_NOTATION") return undefined;
      throw error;
    }
    return "Logged set";
  }

  private applyStartChoice(selection: WorkoutSelection, choice: Exclude<StartChoice, { kind: "REPLACE" }>): Promise<string> {
    if (choice.kind === "ACCEPT") return selection.accept();
    if (choice.kind === "CHOOSE") return selection.choose(choice.sessionRef);
    if (choice.kind === "REST") return selection.rest();
    return selection.start(choice.routineRef, choice.sessionRef);
  }

  private async startWorkout(client: PoolClient, userId: string): Promise<void> {
    if (!(await client.query("select id from users where id=$1 and deleted_at is null", [userId])).rows.length) throw new DomainError("User unavailable", "UNAUTHORIZED");
    const selection = new WorkoutSelection(client, userId);
    if (await selection.active()) return;
    const target = await selection.target();
    if ("clarification" in target) throw new DomainError(target.clarification, "AMBIGUOUS_WORKOUT");
    await selection.create(target.template.id, "ACTIVE");
  }

  private async logSets(client: PoolClient, userId: string, inboundId: string | null, commandKey: string, text: string): Promise<void> {
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
    if (!profile.rows[0]) throw new DomainError("Configure your preferred weight unit before logging sets", "PREFERRED_UNIT_REQUIRED");
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
    const persisted = await client.query(
      `insert into outbound_messages
       (id, user_id, inbound_message_id, provider_account_id, provider_user_identity_hash, body_hash, body, status, sent_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'PENDING', null)
       on conflict (inbound_message_id) do update set inbound_message_id=excluded.inbound_message_id returning id`,
      [outboundId, userId, inboundId, message.providerAccountId, message.providerUserIdentityHash, sha256(body), body]
    );
    await client.query(`update inbound_messages set outbound_message_id = $1 where id = $2 and outbound_message_id is null`, [
      persisted.rows[0]!.id,
      inboundId
    ]);
    await client.query(`update outbound_messages set notification_link_id=(select verified_link_id from inbound_messages where id=$3),
      owner_generation=(select data_control_generation from users where id=$2) where id=$1 and notification_link_id is null`,
    [persisted.rows[0]!.id, userId, inboundId]);
    const welcomeBody = "WhatsApp connected successfully. You can now receive and log your workouts.";
    if (parseLinkCommand(message.text) && (body === welcomeBody || body === formatWhatsAppMessage(welcomeBody))) {
      const link = (await client.query("select verified_link_id from inbound_messages where id=$1", [inboundId])).rows[0]?.verified_link_id;
      if (link) {
        await client.query("update outbound_messages set notification_key=$2 where id=$1", [persisted.rows[0]!.id, `welcome:${link}`]);
        await queuePlanReady(client, userId, link, message.providerAccountId);
      }
    }
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
