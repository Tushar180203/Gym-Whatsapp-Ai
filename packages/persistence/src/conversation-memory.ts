import type { PoolClient } from "pg";
import { memoryText, type ConversationTurn } from "../../domain/src/conversation/memory.js";
import { localDate } from "../../domain/src/time/local-calendar.js";

export class ConversationMemory {
  constructor(private readonly db: PoolClient, private readonly userId: string) {}
  async recent(limit = 24): Promise<ConversationTurn[]> {
    const rows = (await this.db.query(`select role,content,occurred_at from conversation_turns where user_id=$1 and expires_at>clock_timestamp() and exists(select 1 from user_profiles p where p.user_id=$1 and p.conversation_memory_enabled)
      order by occurred_at desc,id desc limit $2`, [this.userId, limit])).rows;
    return rows.reverse().map(row => ({ role: row.role, content: row.content, occurredAt: row.occurred_at.toISOString() }));
  }
  async remember(messageId: string, input: string, reply: string, occurredAt: Date) {
    await this.db.query("delete from conversation_turns where expires_at<=clock_timestamp()");
    const enabled = (await this.db.query("select conversation_memory_enabled from user_profiles where user_id=$1", [this.userId])).rows[0]?.conversation_memory_enabled;
    if (!enabled || occurredAt.getTime() < Date.now() - 30 * 86400000) return;
    const text = memoryText(input);
    if (!text) return;
    const answer = memoryText(reply);
    for (const [role, content] of [["user", text], ["assistant", answer]] as const) {
      if (!content) continue;
      await this.db.query(`insert into conversation_turns(user_id,inbound_message_id,role,content,occurred_at,expires_at)
        values($1,$2,$3,$4,$5,$5::timestamptz+interval '30 days') on conflict(inbound_message_id,role) do nothing`, [this.userId, messageId, role, content, occurredAt]);
    }
    await this.db.query(`delete from conversation_turns where user_id=$1 and id not in
      (select id from conversation_turns where user_id=$1 order by occurred_at desc,id desc limit 200)`, [this.userId]);
  }
  async recall(timeZone: string, options: { onDate?: string; period?: "MORNING" | "AFTERNOON" | "EVENING"; search?: string }) {
    const rows = await this.recent(200);
    const terms = options.search?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const matches = rows.filter(row => {
      if (options.onDate && localDate(new Date(row.occurredAt), timeZone) !== options.onDate) return false;
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(row.occurredAt)));
      if (options.period && !(options.period === "MORNING" ? hour < 12 : options.period === "AFTERNOON" ? hour >= 12 && hour < 18 : hour >= 18)) return false;
      return !terms.length || terms.every(term => row.content.toLowerCase().includes(term));
    }).slice(-6);
    if (!matches.length) return "I don’t have a matching saved chat in the last 30 days. Tell me the exercise or what we discussed. Recorded workout history is available separately.";
    return `Saved chat (${timeZone}); messages are not proof of a recorded workout:\n${matches.map(row => `${localDate(new Date(row.occurredAt), timeZone)} ${new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(row.occurredAt))} ${row.role === "user" ? "You said" : "I replied"}: ${row.content.slice(0, 350)}`).join("\n")}`;
  }
}
