import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-cron-secret","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"Method tidak didukung"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const body=await req.json().catch(()=>({}));
  if(body.action==="subscribe"||body.action==="unsubscribe"){
   const auth=req.headers.get("Authorization")||"";
   if(!auth.startsWith("Bearer "))return reply({error:"Login diperlukan"},401);
   const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
   const {data,error}=await client.auth.getUser();if(error||!data.user)return reply({error:"Sesi tidak valid"},401);
   if(body.action==="unsubscribe"){
    if(body.endpoint)await admin.from("push_subscriptions").delete().eq("user_id",data.user.id).eq("endpoint",body.endpoint);
    return reply({status:"ok"});
   }
   const sub=body.subscription;
   if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth)return reply({error:"Subscription browser tidak valid"},400);
   const {error:saveError}=await admin.from("push_subscriptions").upsert({user_id:data.user.id,endpoint:sub.endpoint,subscription:sub,updated_at:new Date().toISOString()},{onConflict:"endpoint"});
   if(saveError)throw saveError;
   return reply({status:"ok"});
  }
  const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!serviceRole||req.headers.get("Authorization")!==`Bearer ${serviceRole}`)return reply({error:"Tidak diizinkan"},401);
  const publicKey=Deno.env.get("VAPID_PUBLIC_KEY"),privateKey=Deno.env.get("VAPID_PRIVATE_KEY"),subject=Deno.env.get("VAPID_SUBJECT")||"mailto:support@ritelai-vision.pages.dev";
  if(!publicKey||!privateKey)return reply({error:"VAPID belum dikonfigurasi"},503);
  webpush.setVapidDetails(subject,publicKey,privateKey);
  const calendar=await fetch(url+"/functions/v1/quick-service",{method:"POST",headers:{"Content-Type":"application/json","apikey":anon,"Authorization":`Bearer ${service}`},body:JSON.stringify({action:"market_calendar"})});
  if(!calendar.ok)throw new Error("Gagal mengambil kalender pasar");
  const payload=await calendar.json(),now=Date.now(),events=(payload.events||[]).filter((e:any)=>{
   const t=Date.parse(e.time),impact=String(e.importance||"").toLowerCase();
   return Number.isFinite(t)&&t>now&&t<=now+15*60*1000&&["high","medium","low"].includes(impact)&&e.name;
  });
  let sent=0,skipped=0;
  for(const e of events){
   const key=String(e.id||e.name)+":"+String(e.time);
   const {data:existing}=await admin.from("push_event_deliveries").select("id").eq("event_key",key).maybeSingle();
   if(existing){skipped++;continue}
   const high=String(e.importance).toLowerCase()==="high";
   const title=(high?"🔴 PRIORITAS TINGGI · ":"🟡 NEWS ALERT · ")+String(e.name);
   const bodyText=[String(e.currency||e.countryCode||"Market"),"Rilis "+new Date(e.time).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})+" WIB",high?"Periksa potensi volatilitas pasar.":"Agenda ekonomi berdampak; pantau instrumen terkait."].join(" · ");
   const {data:subs}=await admin.from("push_subscriptions").select("id,subscription");
   let delivered=false;
   for(const s of subs||[]){
    try{await webpush.sendNotification(s.subscription,JSON.stringify({title,body:bodyText,url:"/?tab=news",tag:"ritelai-"+key,priority:high?"high":"normal"}));delivered=true}
    catch(err:any){if(err?.statusCode===404||err?.statusCode===410)await admin.from("push_subscriptions").delete().eq("id",s.id)}
   }
   if(delivered){await admin.from("push_event_deliveries").insert({event_key:key});sent++}
  }
  return reply({status:"ok",events:events.length,sent,skipped});
 }catch(e){return reply({error:e instanceof Error?e.message:String(e)},500)}
});