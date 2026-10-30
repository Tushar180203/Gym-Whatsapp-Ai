import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/index.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";
import { WhatsAppInboundAdapter, type WhatsAppFixturePayload } from "../../packages/messaging/src/index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const requirePostgres = process.env.REQUIRE_POSTGRES_TESTS === "1";
const describePostgres = connectionString || requirePostgres ? describe : describe.skip;

function rawWhatsApp(id: string, text: string, from = "15555550123"): string {
  const payload: WhatsAppFixturePayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-1",
        changes: [
          {
            value: {
              metadata: { phone_number_id: "phone-1" },
              messages: [{ id, from, text: { body: text } }]
            }
          }
        ]
      }
    ]
  };
  return JSON.stringify(payload);
}

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    DROP TABLE IF EXISTS
      schema_migrations,
      conversation_turns,
      conversation_states,
      outbound_delivery_attempts, whatsapp_recipient_addresses,
    data_control_requests, exercise_muscle_classifications,
      corrections,
      pending_confirmations,
      exercise_aliases,
      outbound_messages,
      command_executions,
      inbound_messages,
      workout_sets,
      session_exercises,
      workout_sessions,
      planned_exercises,
      routine_sequence_cursors,
      workout_session_templates,
      exercise_identities,
      routines,
      account_link_tokens,
      whatsapp_identity_links,
      whatsapp_provider_user_identities,
      whatsapp_provider_accounts,
      auth_sessions,
      user_profiles,
      users
    CASCADE
  `);
}

async function send(
  app: PostgresVerticalSliceApp,
  id: string,
  text: string,
  options: { crashAfterCommandBeforeOutbound?: boolean } = {}
): Promise<unknown> {
  const adapter = new WhatsAppInboundAdapter("secret");
  const [message] = adapter.normalize(rawWhatsApp(id, text), adapter.sign(rawWhatsApp(id, text)));
  if (!message) throw new Error("fixture did not produce a message");
  return app.processInbound(message, options);
}

async function readyUser(app: PostgresVerticalSliceApp): Promise<{ userId: string; token: string }> {
  const { userId, sessionToken } = await app.signUp("pg-slice@example.com", "correct horse battery staple");
  await expect(app.currentUser(sessionToken)).resolves.toBe(userId);
  await app.setPreferredWeightUnit(userId, "KG");
  await app.createRoutine(userId);
  return { userId, token: await app.createLinkToken(userId, hashChallenge("15555550123")) };
}

describePostgres("PostgreSQL deterministic vertical slice", () => {
  let app: PostgresVerticalSliceApp;

  beforeEach(async () => {
    if (!connectionString) {
      throw new Error("TEST_DATABASE_URL is required for PostgreSQL persistence verification");
    }
    app = new PostgresVerticalSliceApp({ connectionString: connectionString! });
    await resetDatabase(app.pool);
    await app.migrate();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("runs the migration from an empty database with required constraints", async () => {
    const indexes = await app.pool.query<{ name: string | null }>(`
      select to_regclass('one_active_workout_per_user')::text as name
      union all select to_regclass('one_active_whatsapp_identity_link')::text
      union all select to_regclass('one_active_whatsapp_link_per_user')::text
    `);
    expect(indexes.rows.map((row) => row.name)).toEqual([
      "one_active_workout_per_user",
      "one_active_whatsapp_identity_link",
      "one_active_whatsapp_link_per_user"
    ]);

    const uniques = await app.pool.query<{ table_name: string; count: string }>(`
      select c.relname as table_name, count(*)::text
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      where con.contype = 'u'
        and con.connamespace = current_schema()::regnamespace
        and c.relname in ('inbound_messages', 'command_executions', 'workout_sets', 'account_link_tokens', 'routine_sequence_cursors')
      group by c.relname
    `);
    expect(Object.fromEntries(uniques.rows.map((row) => [row.table_name, Number(row.count)]))).toMatchObject({
      account_link_tokens: 2,
      command_executions: 1,
      inbound_messages: 1,
      routine_sequence_cursors: 1,
      workout_sets: 2
    });
  });

  it("links WhatsApp identity, logs deterministic sets, finishes, and reads persisted history", async () => {
    const { userId, token } = await readyUser(app);
    await send(app, "wa-link", `link ${token}`);
    await send(app, "wa-start", "start");
    await send(app, "wa-accept", "start planned");
    await send(app, "wa-set-1", "45 each 10");
    await send(app, "wa-set-2", "same x 9");
    await send(app, "wa-set-3", "45 kg x 8");
    await send(app, "wa-finish", "finish workout");

    const history = await app.history(userId);
    expect(history).toHaveLength(1);
    expect(history[0]?.workout.status).toBe("COMPLETED");
    expect(history[0]?.sets.map((set) => [set.loadValue, set.weightUnit, set.loadSemantics, set.reps])).toEqual([
      [45, "KG", "PER_HAND_PER_SIDE", 10],
      [45, "KG", "PER_HAND_PER_SIDE", 9],
      [45, "KG", "PER_HAND_PER_SIDE", 8]
    ]);

    const linkCount = await app.pool.query<{ count: string }>(
      `select count(*)::text from whatsapp_identity_links where user_id = $1 and revoked_at is null`,
      [userId]
    );
    expect(Number(linkCount.rows[0]?.count)).toBe(1);
  });

  it("persists across repository restarts", async () => {
    const { userId, token } = await readyUser(app);
    await send(app, "restart-link", `link ${token}`);
    await send(app, "restart-start", "start");
    await send(app, "restart-accept", "start planned");
    await send(app, "restart-set-1", "45 lb x 10");
    await send(app, "restart-set-2", "45 each 9");
    await send(app, "restart-finish", "finish workout");
    await send(app, "restart-complete-choice", "save completed");

    const beforeRestart = await app.history(userId);
    expect(beforeRestart[0]?.sets.map((set) => [set.loadValue, set.weightUnit, set.loadSemantics, set.reps])).toEqual([
      [45, "LB", "PER_HAND_PER_SIDE", 10],
      [45, "KG", "PER_HAND_PER_SIDE", 9]
    ]);

    const storedSets = await app.pool.query<{
      load_value: number;
      weight_unit: string;
      load_semantics: string;
      reps: number;
    }>(
      `select load_value::float8 as load_value, weight_unit, load_semantics, reps
       from workout_sets
       where user_id = $1
       order by set_index`,
      [userId]
    );
    expect(storedSets.rows.map((set) => [set.load_value, set.weight_unit, set.load_semantics, set.reps])).toEqual([
      [45, "LB", "PER_HAND_PER_SIDE", 10],
      [45, "KG", "PER_HAND_PER_SIDE", 9]
    ]);

    await app.close();

    app = new PostgresVerticalSliceApp({ connectionString: connectionString! });
    const history = await app.history(userId);
    expect(history).toHaveLength(1);
    expect(history[0]?.sets.map((set) => [set.loadValue, set.weightUnit, set.loadSemantics, set.reps])).toEqual([
      [45, "LB", "PER_HAND_PER_SIDE", 10],
      [45, "KG", "PER_HAND_PER_SIDE", 9]
    ]);

    const cursor = await app.pool.query<{ name: string }>(
      `select t.name
       from routine_sequence_cursors c
       join workout_session_templates t on t.id = c.next_session_template_id
       where c.user_id = $1`,
      [userId]
    );
    expect(cursor.rows[0]?.name).toBe("Lower");
  });

  it("persists eight completed reps without inventing the failed ninth rep", async () => {
    const { userId, token } = await readyUser(app);
    await send(app, "failure-note-link", `link ${token}`);
    await send(app, "failure-note-start", "start");
    await send(app, "failure-note-accept", "start planned");
    await send(app, "failure-note-set", "50x8 failed the 9th");
    const sets = (await app.pool.query("select load_value::float8 as load,reps from workout_sets where user_id=$1", [userId])).rows;
    expect(sets).toEqual([{ load: 50, reps: 8 }]);
  });

  it("enforces inbound, command, set, concurrency, and one-active-workout idempotency in PostgreSQL", async () => {
    const { userId, token } = await readyUser(app);
    await send(app, "idem-link", `link ${token}`);
    await Promise.all([send(app, "idem-start", "start"), send(app, "idem-start", "start")]);
    await send(app, "idem-accept", "start planned");

    const activeWorkoutCount = await app.pool.query<{ count: string }>(
      `select count(*)::text from workout_sessions where user_id = $1 and status = 'ACTIVE'`,
      [userId]
    );
    expect(Number(activeWorkoutCount.rows[0]?.count)).toBe(1);

    await send(app, "idem-set-1", "45x10");
    await send(app, "idem-set-1", "45x10");

    await send(app, "idem-crash", "45x9", { crashAfterCommandBeforeOutbound: true });
    await send(app, "idem-crash", "45x9");

    await Promise.all([send(app, "idem-concurrent", "45x8"), send(app, "idem-concurrent", "45x8")]);

    const sets = await app.pool.query<{ reps: number }>(
      `select reps from workout_sets where user_id = $1 order by reps desc`,
      [userId]
    );
    expect(sets.rows.map((row) => row.reps)).toEqual([10, 9, 8]);

    const inbound = await app.pool.query<{ count: string }>(
      `select count(*)::text from inbound_messages where provider_message_id in ('idem-set-1', 'idem-crash', 'idem-concurrent')`
    );
    expect(Number(inbound.rows[0]?.count)).toBe(3);

    const commands = await app.pool.query<{ count: string }>(
      `select count(*)::text from command_executions where user_id = $1 and command_type = 'LOG_SET'`,
      [userId]
    );
    expect(Number(commands.rows[0]?.count)).toBe(3);

    const recoveredOutbound = await app.pool.query<{ count: string }>(
      `select count(*)::text
       from outbound_messages o
       join inbound_messages i on i.id = o.inbound_message_id
       where i.provider_message_id = 'idem-crash'`
    );
    expect(Number(recoveredOutbound.rows[0]?.count)).toBe(1);
  });
});
