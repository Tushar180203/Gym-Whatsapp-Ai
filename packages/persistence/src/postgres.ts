import { readFileSync } from "node:fs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { LoadSemantics, NormalizedWhatsAppMessage, WeightUnit } from "../../contracts/src/index.js";
import { DomainError, sha256 } from "./store.js";
import { parseSetMessage } from "../../domain/src/parser/set-parser.js";

export type PostgresSliceConfig = {
  connectionString: string;
};

export type PgHistoryEntry = {
  workout: { id: string; status: string; name: string };
  sets: Array<{
    loadValue: number;
    weightUnit: WeightUnit;
    loadSemantics: LoadSemantics;
    reps: number;
    setIndex: number;
  }>;
};

export class PostgresVerticalSliceApp {
  readonly pool: Pool;

  constructor(config: PostgresSliceConfig) {
    this.pool = new Pool({ connectionString: config.connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async migrate(migrationPath = "packages/persistence/migrations/0001_vertical_slice.sql"): Promise<void> {
    const sql = readFileSync(migrationPath, "utf8");
    await this.pool.query(sql);
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
          const outbound = await client.query(`select id from outbound_messages where inbound_message_id = $1`, [
            inbound.id
          ]);
          if (!outbound.rows[0]) {
            await this.persistOutbound(client, inbound.user_id, inbound.id, message, "Recovered previous result");
          }
        }
        await client.query("commit");
        return { reused: true };
      }
      const userId = await this.resolveUser(client, message);
      await client.query(`update inbound_messages set processing_status = 'PROCESSING', user_id = $2 where id = $1`, [
        inbound.id,
        userId
      ]);
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [userId]);
      const body = await this.applyMessage(client, userId, inbound.id, message.text);
      await client.query(`update inbound_messages set processing_status = 'COMPLETED', processed_at = now() where id = $1`, [
        inbound.id
      ]);
      if (!options.crashAfterCommandBeforeOutbound) {
        await this.persistOutbound(client, userId, inbound.id, message, body);
      }
      await client.query("commit");
      return { reused: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async history(userId: string): Promise<PgHistoryEntry[]> {
    const workouts = await this.pool.query<{ id: string; status: string; name: string }>(
      `select id, status, name from workout_sessions where user_id = $1 and status in ('COMPLETED', 'INCOMPLETE') order by created_at`,
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
         from workout_sets where workout_session_id = $1 order by set_index`,
        [workout.id]
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

  async activeWorkout(userId: string): Promise<{ id: string; status: string; name: string } | null> {
    const result = await this.pool.query<{ id: string; status: string; name: string }>(
      `select id, status, name from workout_sessions where user_id = $1 and status in ('PROPOSED', 'ACTIVE', 'PAUSED') limit 1`,
      [userId]
    );
    return result.rows[0] ?? null;
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
    }>(
      `insert into inbound_messages
       (id, provider, provider_account_id, provider_message_id, provider_user_identity_hash, text_redacted, raw_payload_hash, processing_status)
       values ($1, $2, $3, $4, $5, $6, $7, 'RECEIVED')
       on conflict (provider_account_id, provider_message_id) do update
       set provider_message_id = excluded.provider_message_id
       returning id, processing_status, user_id`,
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
    if (lower === "start") {
      await this.startWorkout(client, userId);
      return "Started workout";
    }
    if (lower === "finish workout" || lower === "finish" || lower === "done") {
      await this.finishWorkout(client, userId);
      return "Finished workout";
    }
    const commandKey = `${inboundId}:log`;
    const existing = await client.query(
      `select id from command_executions where user_id = $1 and idempotency_key = $2 and status = 'COMPLETED'`,
      [userId, commandKey]
    );
    if (existing.rows[0]) return "Logged set";
    await this.logSets(client, userId, inboundId, commandKey, text);
    return "Logged set";
  }

  private async startWorkout(client: PoolClient, userId: string): Promise<void> {
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
      `select * from planned_exercises where session_template_id = $1 order by order_index`,
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
          plannedExercise.order_index === 0 ? "ACTIVE" : "PLANNED",
          plannedExercise.planned_set_count,
          plannedExercise.rep_target_min,
          plannedExercise.rep_target_max
        ]
      );
      if (plannedExercise.order_index === 0) {
        await client.query(`update workout_sessions set active_session_exercise_id = $1 where id = $2`, [
          sessionExerciseId,
          workoutId
        ]);
      }
    }
  }

  private async logSets(client: PoolClient, userId: string, inboundId: string, commandKey: string, text: string): Promise<void> {
    const workout = await client.query<{ id: string; active_session_exercise_id: string }>(
      `select id, active_session_exercise_id from workout_sessions where user_id = $1 and status = 'ACTIVE'`,
      [userId]
    );
    const active = workout.rows[0];
    if (!active) throw new DomainError("No active workout", "NO_ACTIVE_WORKOUT");
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
      `select load_value, weight_unit, load_semantics from workout_sets where session_exercise_id = $1 order by set_index desc limit 1`,
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
        `select count(*) from workout_sets where session_exercise_id = $1`,
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
  }

  private async finishWorkout(client: PoolClient, userId: string): Promise<void> {
    const workout = await client.query<{ id: string; routine_id: string; session_template_id: string }>(
      `select id, routine_id, session_template_id from workout_sessions where user_id = $1 and status = 'ACTIVE'`,
      [userId]
    );
    const row = workout.rows[0];
    if (!row) throw new DomainError("No active workout", "NO_ACTIVE_WORKOUT");
    await client.query(
      `update workout_sessions set status = 'COMPLETED', completion_intent = 'COMPLETE', completed_at = now(), active_session_exercise_id = null where id = $1`,
      [row.id]
    );
    const next = await client.query<{ id: string; sequence_index: number }>(
      `select id, sequence_index from workout_session_templates
       where routine_id = $1 and sequence_index > (select sequence_index from workout_session_templates where id = $2)
       order by sequence_index asc limit 1`,
      [row.routine_id, row.session_template_id]
    );
    const fallback = await client.query<{ id: string; sequence_index: number }>(
      `select id, sequence_index from workout_session_templates where routine_id = $1 order by sequence_index asc limit 1`,
      [row.routine_id]
    );
    const target = next.rows[0] ?? fallback.rows[0];
    if (target) {
      await client.query(
        `update routine_sequence_cursors set next_session_template_id = $1, cursor_sequence_index = $2 where routine_id = $3`,
        [target.id, target.sequence_index, row.routine_id]
      );
    }
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
       (id, user_id, inbound_message_id, provider_account_id, provider_user_identity_hash, body_hash, status, sent_at)
       values ($1, $2, $3, $4, $5, $6, 'SENT', now())
       on conflict do nothing`,
      [outboundId, userId, inboundId, message.providerAccountId, message.providerUserIdentityHash, sha256(body)]
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
