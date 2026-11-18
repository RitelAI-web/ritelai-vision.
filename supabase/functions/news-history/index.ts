import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const reply=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers});
const allowedRoles=["owner","admin","super_admin"];
const checkpoints=[0,1,2,5,15,30];
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return reply({error:"Gunakan POST."},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return reply({error:"Login diperlukan."},401);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!key)return reply({error:"Konfigurasi server belum lengkap."},503);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:userData,error:userError}=await userClient.auth.getUser();
  if(userError||!userData.user)return reply({error:"Sesi tidak valid."},401);
  const admin=createClient(url,key,{auth:{persistSession:false}});
  const uid=userData.user.id;
  const [{data:profile},{data:sub}]=await Promise.all([
    admin.from("profiles").select("role").eq("id",uid).maybeSingle(),
    admin.from("subscriptions").select("status,ends_at,plans(code)").eq("user_id",uid).eq("status","active").gt("ends_at",new Date().toISOString()).order("ends_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  const role=String(profile?.role || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  const plan=String((sub?.plans as any)?.code||"").toLowerCase();
  if(!allowedRoles.includes(role)&&!["pro","elite"].includes(plan))return reply({error:"News History hanya tersedia untuk paket Pro dan Elite aktif."},403);
  let body:any;try{body=await req.json()}catch{return reply({error:"JSON tidak valid."},400)}
  if(body.action==="list"){
    const {data,error}=await admin.from("analysis_history").select("id,asset,timeframe,result,created_at").eq("user_id",uid).eq("asset","NEWS_HISTORY").order("created_at",{ascending:false}).limit(250);
    if(error)return reply({error:error.message},500);
    const items=(data||[]).map((row:any)=>{
      const value=row.result||{};
      return {id:row.id,user_id:uid,event_id:value.event_id,event_time:value.event_time,captured_at:row.created_at,checkpoint_minutes:Number(value.checkpoint_minutes)||0,event_snapshot:value.event_snapshot||{},ai_snapshot:value.ai_snapshot||{},quotes_snapshot:value.quotes_snapshot||{},validation_status:value.validation_status||"PENDING",execution_type:"AI_SIGNAL",outcome:"UNVERIFIED",created_at:row.created_at};
    });
    return reply({status:"ok",items,plan:allowedRoles.includes(role)?"admin":plan});
  }
  if(body.action==="save"){
    const eventId=String(body.event_id||"").slice(0,240);
    const checkpoint=Number(body.checkpoint_minutes);
    const eventTime=String(body.event_time||"");
    if(!eventId||!checkpoints.includes(checkpoint)||!Number.isFinite(Date.parse(eventTime)))return reply({error:"Identitas event, waktu, atau checkpoint tidak valid."},400);
    const safeObject=(v:any)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
    const event=safeObject(body.event_snapshot),ai=safeObject(body.ai_snapshot),quotes=safeObject(body.quotes_snapshot);
    const actual=event.actual??event.actualValue??null;
    const hasQuote=Object.keys(quotes).length>0;
    const validation=actual!=null&&hasQuote?"PARTIAL":"PENDING";
    const eventIso=new Date(eventTime).toISOString();
    const snapshot={event_id:eventId,event_time:eventIso,checkpoint_minutes:checkpoint,event_snapshot:event,ai_snapshot:ai,quotes_snapshot:quotes,validation_status:validation};
    const {data:existingRows,error:lookupError}=await admin.from("analysis_history").select("id,result").eq("user_id",uid).eq("asset","NEWS_HISTORY").order("created_at",{ascending:false}).limit(250);
    if(lookupError)return reply({error:lookupError.message},500);
    const existing=(existingRows||[]).find((x:any)=>x.result?.event_id===eventId&&Number(x.result?.checkpoint_minutes)===checkpoint);
    const write=existing
      ? await admin.from("analysis_history").update({timeframe:"T+"+checkpoint+"m",result:snapshot}).eq("id",existing.id).eq("user_id",uid).select("id,created_at").single()
      : await admin.from("analysis_history").insert({user_id:uid,asset:"NEWS_HISTORY",timeframe:"T+"+checkpoint+"m",result:snapshot}).select("id,created_at").single();
    if(write.error)return reply({error:write.error.message},500);
    return reply({status:"ok",item:{id:write.data.id,user_id:uid,...snapshot,captured_at:write.data.created_at,created_at:write.data.created_at,execution_type:"AI_SIGNAL",outcome:"UNVERIFIED"}});
  }
  return reply({error:"Action tidak dikenal."},400);
});
