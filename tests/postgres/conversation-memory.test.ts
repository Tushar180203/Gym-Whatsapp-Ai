import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { MockStructuredOutputClient } from "../../packages/ai/src/testing/mock-structured-output-client.js";
import { StaticPromptRegistry } from "../../packages/ai/src/prompt-registry.js";
import { StructuredIntentInterpreter } from "../../packages/ai/src/structured-intent-interpreter.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/whatsapp/inbound-adapter.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";
import type { ProposedAction } from "../../packages/contracts/src/ai/actions.js";
const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url ? describe : describe.skip;
pgDescribe("timestamped conversation memory", () => {
  let app: PostgresVerticalSliceApp, scoped: string, mock: MockStructuredOutputClient, user: {userId:string;sessionToken:string}, index: number;
  const instance = () => new PostgresVerticalSliceApp({ connectionString: scoped, interpreter: new StructuredIntentInterpreter(mock, new StaticPromptRegistry("mock")) });
  const propose = (action: ProposedAction) => mock.enqueue({ schemaVersion: "workout-action.v1", action, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
  async function send(text: string, id = `memory-${index++}`) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{id:"business",changes:[{value:{metadata:{phone_number_id:"memory-account"},messages:[{id,from:"15555550123",text:{body:text}}]}}]}] });
    const adapter = new WhatsAppInboundAdapter("fixture");
    return app.processInbound(adapter.normalize(raw,adapter.sign(raw))[0]!);
  }
  beforeEach(async () => {
    const admin = new Pool({ connectionString: url! });
    await admin.query("drop schema if exists conversation_memory_test cascade"); await admin.query("create schema conversation_memory_test"); await admin.end();
    const parsed = new URL(url!); parsed.searchParams.set("options","-c search_path=conversation_memory_test"); scoped=parsed.toString();
    mock=new MockStructuredOutputClient(); app=instance(); await app.migrate(); index=0;
    user=await app.signUp("memory@example.com","correct horse battery staple");
    await app.configure(user.sessionToken,c=>c.profile({preferredWeightUnit:"KG",timeZone:"Asia/Kolkata"}));
    await send(`LINK ${await app.createLinkToken(user.userId,hashChallenge("15555550123"))}`);
  });
  afterEach(async()=>{await app?.close();});
  it("remembers prior chats across restart, supplies local clock, and reuses duplicate messages",async()=>{
    propose({type:"UNKNOWN",reason:"No completed set"});
    await send("I was asking about incline presses earlier","earlier");
    await send("I was asking about incline presses earlier","earlier");
    expect((await app.pool.query("select id from conversation_turns where role='user'")).rows).toHaveLength(1);
    await app.close();app=instance();
    propose({type:"QUERY_CONVERSATION",search:"incline"});
    expect((await send("which exercise did I ask about earlier?")).body).toContain("I was asking about incline presses earlier");
    const context=JSON.parse(mock.requests.at(-1)!.userText).context;
    expect(context.clock.timeZone).toBe("Asia/Kolkata");
    expect(context.recentConversation.some((turn:{content:string})=>turn.content.includes("incline"))).toBe(true);
    expect(JSON.stringify(context)).not.toContain(user.userId);
  });
  it("recalls an earlier local day without AI and excludes expired or foreign memory",async()=>{
    await send("hello","saved");
    await app.pool.query("update conversation_turns set occurred_at=clock_timestamp()-interval '1 day',content='Earlier incline discussion' where user_id=$1 and role='user'",[user.userId]);
    await app.pool.query("update conversation_turns set expires_at=clock_timestamp()-interval '1 second' where role='assistant'");
    const other=await app.signUp("other-memory@example.com","correct horse battery staple");
    await app.pool.query("insert into conversation_turns(user_id,inbound_message_id,role,content,occurred_at,expires_at) select $1,id,'assistant','private foreign chat',clock_timestamp(),clock_timestamp()+interval '1 day' from inbound_messages where provider_message_id='memory-0'",[other.userId]);
    const result=await send("what did I tell you yesterday?");
    expect(result.body).toContain("Earlier incline discussion");expect(result.body).not.toContain("private foreign chat");expect(mock.requests).toHaveLength(0);
  });
  it("exports memory and clears it when disabled",async()=>{
    await send("hello");
    const exported=await app.configure(user.sessionToken,async c=>c.profile({preferredWeightUnit:"KG"}));
    expect(exported.conversationMemoryEnabled).toBe(true);
    const data=await app.requestExport(user.sessionToken,{idempotencyKey:"memory-export"});
    const download=await app.exportResult(user.sessionToken,data.id);
    expect(download.data?.data.conversationMemory.length).toBeGreaterThan(0);
    await app.configure(user.sessionToken,c=>c.profile({preferredWeightUnit:"KG",conversationMemoryEnabled:false}));
    await send("hello");
    expect((await app.pool.query("select * from conversation_turns where user_id=$1",[user.userId])).rows).toHaveLength(0);
  });
  it.each(["DELETE_WORKOUT_DATA", "DELETE_ACCOUNT"] as const)("clears memory on confirmed %s", async type => {
    await send("hello");
    const request = await app.requestDeletion(user.sessionToken, { type, idempotencyKey: "memory-deletion" });
    expect((await app.confirmDeletion(user.sessionToken, request.id, { confirm: true })).status).toBe("COMPLETED");
    expect((await app.pool.query("select id from conversation_turns where user_id=$1", [user.userId])).rows).toHaveLength(0);
  });
  it("does not turn historical numbers or confirmations into a new write",async()=>{
    await app.createRoutine(user.userId);await send("start");await send("start");await send("45x10");
    const before=(await app.pool.query("select id from workout_sets where user_id=$1",[user.userId])).rows;
    propose({type:"LOG_SET",set:{loadValue:45,reps:10,weightUnit:"KG"}});
    await send("do that thing I mentioned before");
    expect((await app.pool.query("select id from workout_sets where user_id=$1",[user.userId])).rows).toEqual(before);
  });
});
