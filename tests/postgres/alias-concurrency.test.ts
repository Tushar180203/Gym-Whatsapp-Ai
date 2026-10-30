import {describe,it,expect} from "vitest";
import {Pool} from "pg";
import {PostgresVerticalSliceApp} from "../../packages/persistence/src/postgres.js";
import {WhatsAppInboundAdapter} from "../../packages/messaging/src/index.js";
import {hashChallenge} from "../../packages/messaging/src/whatsapp/link-challenge.js";
const url=process.env.TEST_DATABASE_URL;
(url?describe:describe.skip)("private alias confirmation concurrency",()=>{
  it("one user's alias cannot invalidate another user's confirmation for the shared identity",async()=>{
    const admin=new Pool({connectionString:url!});
    await admin.query("drop schema if exists alias_concurrency_test cascade");await admin.query("create schema alias_concurrency_test");await admin.end();
    const scoped=new URL(url!);scoped.searchParams.set("options","-c search_path=alias_concurrency_test");
    let targetRef="Barbell Bench Press",alias="my bench";
    const app=new PostgresVerticalSliceApp({connectionString:scoped.toString(),interpreter:{async interpret(){return {schemaVersion:"workout-action.v1",action:{type:"MAP_EXERCISE_ALIAS",alias,exerciseRef:targetRef},confidence:"high",requiresClarification:false,rationaleCodes:[],forbiddenDirectMutation:true};}}});
    const adapter=new WhatsAppInboundAdapter("synthetic-alias-secret");let index=0;
    async function send(from:string,text:string){const raw=JSON.stringify({object:"whatsapp_business_account",entry:[{id:"synthetic-alias-business",changes:[{value:{metadata:{phone_number_id:"alias-account"},messages:[{id:`alias-${index++}`,from,text:{body:text}}]}}]}]});return app.processInbound(adapter.normalize(raw,adapter.sign(raw))[0]!);}
    try{
      await app.migrate();
      const users=await Promise.all([app.signUp("alias-a@example.invalid","synthetic test password"),app.signUp("alias-b@example.invalid","synthetic test password")]);
      const senders=["15555550001","15555550002"];
      for(let i=0;i<2;i++)await send(senders[i]!,`LINK ${await app.createLinkToken(users[i]!.userId,hashChallenge(senders[i]!))}`);
      const version=(await app.pool.query("select version from exercise_identities where id='global_barbell_bench_press'")).rows[0].version;
      for(const sender of senders)expect((await send(sender,"please call Barbell Bench Press my bench")).body).toContain("Map my bench to Barbell Bench Press");
      for(const sender of senders)expect((await send(sender,"yes")).body).toContain("applied");
      expect((await app.pool.query("select version from exercise_identities where id='global_barbell_bench_press'")).rows[0].version).toBe(version);
      const aliases=(await app.pool.query("select user_id,alias_text,exercise_identity_id from exercise_aliases where alias_text='my bench' order by user_id")).rows;
      expect(aliases).toHaveLength(2);expect(new Set(aliases.map(a=>a.user_id))).toEqual(new Set(users.map(u=>u.userId)));
      expect(aliases.every(a=>a.exercise_identity_id==="global_barbell_bench_press")).toBe(true);
      expect((await app.pool.query("select status from pending_confirmations")).rows.every(c=>c.status==="APPLIED")).toBe(true);
      const custom=await app.configure(users[0]!.sessionToken,c=>c.customExercise({name:"Private Machine",defaultLoadSemantics:"MACHINE_STACK",confirm:true}));
      if(!("id" in custom))throw new Error("Custom fixture failed");
      targetRef=custom.id;alias="my machine";
      expect((await send(senders[0]!,"please call Private Machine my machine")).body).toContain("Reply yes");
      const customVersion=(await app.pool.query("select version from exercise_identities where id=$1",[custom.id])).rows[0].version;
      await app.configure(users[0]!.sessionToken,c=>c.rename(custom.id,{displayName:"Renamed Private Machine",expectedVersion:customVersion}));
      expect((await send(senders[0]!,"yes")).body).toContain("target changed");
      expect((await app.pool.query("select id from exercise_aliases where user_id=$1 and alias_text='my machine'",[users[0]!.userId])).rows).toHaveLength(0);
    }finally{await app.close();}
  });
});
