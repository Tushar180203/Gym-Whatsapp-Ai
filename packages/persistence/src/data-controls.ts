import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { portableExport, type ExportRows } from "../../domain/src/data-controls/export-service.js";
import { deletionDecision, type DeletionType } from "../../domain/src/data-controls/deletion-service.js";
import { DomainError } from "./store.js";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const exportRequestSchema = z.object({ idempotencyKey: z.string().min(1).max(120) }).strict();
export const deleteRequestSchema = exportRequestSchema.extend({ type: z.enum(["DELETE_ACCOUNT", "DELETE_WORKOUT_DATA"]) }).strict();
export const confirmDeletionSchema = z.object({ confirm: z.literal(true) }).strict();
export type DataRequest = { id: string; userId: string; type: string; status: string; requestedAt: string; confirmedAt: string | null; completedAt: string | null; expiresAt: string | null; resultLocation: string | null; auditSummary: Record<string, unknown> };
export class DataControls {
  constructor(private readonly db: PoolClient, private readonly userId: string, private readonly sessionHash: string) {}
  private view(row: Record<string, any>): DataRequest {
    return { id: row.id, userId: row.user_id, type: row.type, status: row.status, requestedAt: row.requested_at.toISOString(), confirmedAt: row.confirmed_at?.toISOString() ?? null, completedAt: row.completed_at?.toISOString() ?? null, expiresAt: row.expires_at?.toISOString() ?? null, resultLocation: row.result_location, auditSummary: row.audit_summary };
  }
  async ownedData() {
    const rows: ExportRows = {};
    const queries = {
      account: "select id,email,created_at,id as user_id from users where id=$1 and deleted_at is null",
      profile: "select * from user_profiles where user_id=$1",
      conversationMemory: "select user_id,role,content,occurred_at,expires_at from conversation_turns where user_id=$1 and expires_at>clock_timestamp() order by occurred_at,id",
      links: "select l.*,a.provider,a.provider_account_id from whatsapp_identity_links l join whatsapp_provider_user_identities i on i.id=l.whatsapp_provider_user_identity_id join whatsapp_provider_accounts a on a.id=i.whatsapp_provider_account_id where l.user_id=$1 order by l.id",
      routines: "select * from routines where user_id=$1 order by id",
      cursors: "select * from routine_sequence_cursors where user_id=$1 order by id",
      templates: "select t.*,r.user_id from workout_session_templates t join routines r on r.id=t.routine_id where r.user_id=$1 order by t.id",
      plannedExercises: "select p.*,r.user_id from planned_exercises p join workout_session_templates t on t.id=p.session_template_id join routines r on r.id=t.routine_id where r.user_id=$1 order by p.id",
      exercises: "select * from exercise_identities e where owner_user_id=$1 or (owner_user_id is null and (exists(select 1 from workout_sets s where s.exercise_identity_id=e.id and s.user_id=$1 and s.status <> 'DELETED') or exists(select 1 from exercise_aliases a where a.exercise_identity_id=e.id and a.user_id=$1) or exists(select 1 from planned_exercises p join workout_session_templates t on t.id=p.session_template_id join routines r on r.id=t.routine_id where p.exercise_identity_id=e.id and r.user_id=$1))) order by e.id",
      aliases: "select * from exercise_aliases where user_id=$1 order by id",
      classifications: "select * from exercise_muscle_classifications where user_id=$1 order by id",
      workouts: "select * from workout_sessions where user_id=$1 and data_deleted_at is null order by id",
      sessionExercises: "select se.*,w.user_id from session_exercises se join workout_sessions w on w.id=se.workout_session_id where w.user_id=$1 and w.data_deleted_at is null order by se.id",
      sets: "select s.* from workout_sets s join workout_sessions w on w.id=s.workout_session_id and w.user_id=s.user_id where s.user_id=$1 and w.data_deleted_at is null order by s.id",
      corrections: "select c.* from corrections c left join workout_sessions w on w.id=c.workout_session_id where c.user_id=$1 and (c.workout_session_id is null or w.data_deleted_at is null) order by c.id"
    };
    for (const category of Object.keys(queries) as (keyof typeof queries)[]) rows[category] = (await this.db.query(queries[category], [this.userId])).rows;
    return portableExport(this.userId, rows);
  }
  async review() {
    await this.db.query("update data_control_requests set status='EXPIRED',audit_summary=jsonb_build_object('operation',type,'outcome','EXPIRED') where user_id=$1 and status='AWAITING_CONFIRMATION' and expires_at<=clock_timestamp()", [this.userId]);
    const data = await this.ownedData();
    return { categories: Object.entries(data).map(([category, rows]) => ({ category, count: rows.length })), requests: (await this.db.query("select * from data_control_requests where user_id=$1 order by requested_at desc", [this.userId])).rows.map(row => this.view(row)) };
  }
  private digest(data: Awaited<ReturnType<DataControls["ownedData"]>>, type: DeletionType) {
    return hash(JSON.stringify(type === "DELETE_ACCOUNT" ? data : { workouts: data.workouts, sessionExercises: data.sessionExercises, sets: data.sets, corrections: data.corrections, conversationMemory: data.conversationMemory }));
  }
  async request(type: "EXPORT" | DeletionType, key: string) {
    const prior = (await this.db.query("select * from data_control_requests where user_id=$1 and idempotency_key=$2", [this.userId, key])).rows[0];
    if (prior) { if (prior.type !== type) throw new DomainError("Key already used", "INVALID_INPUT"); return this.view(prior); }
    if (type !== "EXPORT") {
      await this.db.query("update data_control_requests set status='EXPIRED',audit_summary=jsonb_build_object('operation',type,'outcome','EXPIRED') where user_id=$1 and status='AWAITING_CONFIRMATION' and expires_at<=clock_timestamp()", [this.userId]);
      if ((await this.db.query("select id from data_control_requests where user_id=$1 and status='AWAITING_CONFIRMATION'", [this.userId])).rows.length) throw new DomainError("Resolve existing deletion request first", "INVALID_INPUT");
    }
    const data = await this.ownedData(), id = randomUUID();
    const result = await this.db.query("insert into data_control_requests(id,user_id,type,status,idempotency_key,creator_session_hash,target_digest,expires_at,completed_at,result_location,result_data,audit_summary) values($1,$2,$3,$4,$5,$6,$7,case when $3 <> 'EXPORT' then clock_timestamp()+interval '10 minutes' end,case when $3='EXPORT' then clock_timestamp() end,$8,$9,$10) returning *",
      [id, this.userId, type, type === "EXPORT" ? "COMPLETED" : "AWAITING_CONFIRMATION", key, this.sessionHash, type === "EXPORT" ? null : this.digest(data, type), type === "EXPORT" ? `/api/data/export/${id}?download=1` : null,
        type === "EXPORT" ? { schemaVersion: "workout-export.v1", exportedAt: new Date().toISOString(), data } : null, { operation: type, outcome: type === "EXPORT" ? "EXPORT_READY" : "CONFIRMATION_REQUIRED" }]);
    return this.view(result.rows[0]);
  }
  async exportResult(id: string) {
    const row = (await this.db.query("select * from data_control_requests where id=$1 and user_id=$2 and type='EXPORT'", [id, this.userId])).rows[0];
    if (!row) throw new DomainError("Request not found", "NOT_FOUND");
    return { request: this.view(row), data: row.status === "COMPLETED" ? row.result_data : null };
  }
  async confirm(id: string) {
    const row = (await this.db.query("select * from data_control_requests where id=$1 and user_id=$2 and type <> 'EXPORT' for update", [id, this.userId])).rows[0];
    if (!row) throw new DomainError("Request not found", "NOT_FOUND");
    if (row.status === "COMPLETED") return this.view(row);
    const decision = deletionDecision({ userId: row.user_id, status: row.status, expiresAt: row.expires_at, targetDigest: row.target_digest }, this.userId, true, this.digest(await this.ownedData(), row.type), new Date());
    if (decision !== "APPLY") {
      if (decision === "EXPIRED" || decision === "STALE") await this.db.query("update data_control_requests set status=$2,audit_summary=$3 where id=$1", [id, decision, { operation: row.type, outcome: decision }]);
      return this.view((await this.db.query("select * from data_control_requests where id=$1", [id])).rows[0]);
    }
    const sets = await this.db.query("update workout_sets set status='DELETED' where user_id=$1 and status <> 'DELETED'", [this.userId]);
    await this.db.query("delete from conversation_turns where user_id=$1", [this.userId]);
    await this.db.query("delete from conversation_states where user_id=$1", [this.userId]);
    const workouts = await this.db.query("update workout_sessions set status='DISCARDED',discarded_at=coalesce(discarded_at,clock_timestamp()),data_deleted_at=clock_timestamp(),active_session_exercise_id=null,completion_choice_pending=false,version=version+1 where user_id=$1 and data_deleted_at is null", [this.userId]);
    await this.db.query("update users set data_control_generation=data_control_generation+1 where id=$1", [this.userId]);
    await this.db.query("update pending_confirmations set status='STALE' where user_id=$1 and status='PENDING'", [this.userId]);
    await this.db.query("update data_control_requests set status='REVOKED',result_data=null,result_location=null,audit_summary=jsonb_build_object('operation',type,'outcome','REVOKED') where user_id=$1 and type='EXPORT' and status='COMPLETED'", [this.userId]);
    if (row.type === "DELETE_ACCOUNT") {
      await this.db.query("update users set deleted_at=clock_timestamp() where id=$1", [this.userId]);
      await this.db.query("update auth_sessions set invalidated_at=clock_timestamp() where user_id=$1 and invalidated_at is null", [this.userId]);
      await this.db.query("update whatsapp_identity_links set status='REVOKED',revoked_at=clock_timestamp() where user_id=$1 and revoked_at is null", [this.userId]);
      await this.db.query("update account_link_tokens set status='SUPERSEDED' where user_id=$1 and status='PENDING'", [this.userId]);
    }
    const summary = { operation: row.type, outcome: "COMPLETED", workoutsAffected: workouts.rowCount, setsAffected: sets.rowCount, mode: "SOFT_DELETE" };
    return this.view((await this.db.query("update data_control_requests set status='COMPLETED',confirmed_at=clock_timestamp(),completed_at=clock_timestamp(),audit_summary=$2 where id=$1 returning *", [id, summary])).rows[0]);
  }
}
