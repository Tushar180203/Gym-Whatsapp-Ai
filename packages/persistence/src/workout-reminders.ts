import { randomUUID, createHash } from "node:crypto";
import type { Pool } from "pg";
import { messageTemplateSchema, type MessageTemplate } from "../../contracts/src/messaging/template.js";
import { morningReminder } from "../../domain/src/reminders/morning-reminder.js";
import { localClock, localDate, validTimeZone } from "../../domain/src/time/local-calendar.js";

export type ReminderConfiguration = { accountId: string; template?: Pick<MessageTemplate, "name" | "languageCode"> };
/** Default preview is read-only. Queueing shares the command pipeline's per-user lock. */
export async function queueWorkoutReminders(pool: Pool, config: ReminderConfiguration, now = new Date(), dryRun = true) {
  const result = { eligible: 0, queued: 0, closedWindow: 0 };
  const candidates = (await pool.query(`select p.user_id,p.time_zone from user_profiles p join users u on u.id=p.user_id
    where p.workout_reminders_enabled and u.deleted_at is null order by p.user_id`)).rows;
  for (const candidate of candidates) {
    if (!validTimeZone(candidate.time_zone)) continue;
    const time = localClock(now, candidate.time_zone).localTime;
    if (time < "05:00" || time >= "05:10") continue;
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select pg_advisory_xact_lock(hashtext($1))", [candidate.user_id]);
      const profile = (await db.query(`select p.time_zone,p.workout_reminders_enabled,u.data_control_generation,l.id as link_id,
        a.provider_account_id,i.provider_user_identity_hash,r.last_inbound_at
        from user_profiles p join users u on u.id=p.user_id
        join whatsapp_identity_links l on l.user_id=p.user_id and l.status='VERIFIED' and l.revoked_at is null and l.opt_in_at is not null
        join whatsapp_provider_user_identities i on i.id=l.whatsapp_provider_user_identity_id
        join whatsapp_provider_accounts a on a.id=i.whatsapp_provider_account_id and a.provider='WHATSAPP_CLOUD_API'
        join whatsapp_recipient_addresses r on r.identity_id=i.id
        where p.user_id=$1 and u.deleted_at is null and a.provider_account_id=$2 order by l.linked_at desc limit 1`, [candidate.user_id, config.accountId])).rows[0];
      if (!profile || !profile.workout_reminders_enabled || !validTimeZone(profile.time_zone)) { await db.query("commit"); continue; }
      const age = now.getTime() - new Date(profile.last_inbound_at).getTime();
      if (!config.template && (!Number.isFinite(age) || age < -60_000 || age >= 24 * 60 * 60_000)) {
        result.closedWindow++; await db.query("commit"); continue;
      }
      const routines = (await db.query(`select r.name,t.name as session_name,r.schedule_metadata from routines r
        join routine_sequence_cursors c on c.routine_id=r.id and c.user_id=r.user_id
        join workout_session_templates t on t.id=c.next_session_template_id and t.routine_id=r.id
        where r.user_id=$1 and r.archived_at is null and t.archived_at is null and exists
        (select 1 from planned_exercises p where p.session_template_id=t.id and p.removed_at is null)
        order by r.created_at,r.id`, [candidate.user_id])).rows;
      const active = (await db.query("select id from workout_sessions where user_id=$1 and status in ('PROPOSED','ACTIVE','PAUSED') and data_deleted_at is null limit 1", [candidate.user_id])).rows.length > 0;
      const trained = (await db.query(`select coalesce(completed_at,started_at,created_at) as date from workout_sessions w
        where w.user_id=$1 and w.status in ('COMPLETED','INCOMPLETE') and w.data_deleted_at is null
        and coalesce(completed_at,started_at,created_at) <= $2 and coalesce(completed_at,started_at,created_at) > $2::timestamptz-interval '2 days'
        and exists(select 1 from workout_sets s where s.workout_session_id=w.id and s.user_id=$1 and s.status='RECORDED')`, [candidate.user_id, now])).rows;
      const plan = morningReminder({ now, enabled: profile.workout_reminders_enabled, timeZone: profile.time_zone,
        routines: routines.map(row => ({ name: row.name, sessionName: row.session_name, plannedDays: row.schedule_metadata?.plannedDays ?? [] })),
        hasActiveWorkout: active, trainedToday: trained.some(row => localDate(new Date(row.date), profile.time_zone) === localDate(now, profile.time_zone)) });
      if (plan) {
        const key = `workout-reminder:${candidate.user_id}:${plan.localDate}`;
        if (!(await db.query("select id from outbound_messages where notification_key=$1", [key])).rows.length) {
          result.eligible++;
          const template = config.template ? messageTemplateSchema.parse({ ...config.template, bodyParameters: [plan.summary] }) : null;
          if (!dryRun) {
            const inserted = await db.query(`insert into outbound_messages
              (id,user_id,provider_account_id,provider_user_identity_hash,body_hash,body,status,notification_key,notification_link_id,owner_generation,message_template,notification_expires_at)
              values($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9,$10,$11) on conflict(notification_key) do nothing returning id`,
            [`outbound_${randomUUID()}`, candidate.user_id, profile.provider_account_id, profile.provider_user_identity_hash,
              createHash("sha256").update(plan.body).digest("hex"), plan.body, key, profile.link_id, profile.data_control_generation, template ? JSON.stringify(template) : null, plan.expiresAt]);
            result.queued += inserted.rows.length;
          }
        }
      }
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    finally { db.release(); }
  }
  return result;
}
