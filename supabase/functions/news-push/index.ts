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
  const isServiceCall=!!serviceRole&&req.headers.get("Authorization")===`Bearer ${serviceRole}`;
  const cronToken=req.headers.get("x-cron-secret")||"";
  let isCronCall=false;
  if(cronToken){
   const {data:valid,error:verifyError}=await admin.rpc("verify_news_push_cron_secret",{p_token:cronToken});
   isCronCall=!verifyError&&valid===true;
  }
  if(!isServiceCall&&!isCronCall)return reply({error:"Tidak diizinkan"},401);
  const publicKey="BFFqStWjPiRarL3JUvF8BnmM3GWBA5Go8_REDbNi11PTe5n6-0ciBtnJY10KQubNJ69Ve3TdI28ADv398LvSvo8";
  const {data:privateKey,error:privateKeyError}=await admin.rpc("get_news_push_vapid_private_key");
  if(privateKeyError||!privateKey)return reply({error:"VAPID private key belum tersedia di Supabase Vault"},503);
  const subject=Deno.env.get("VAPID_SUBJECT")||"mailto:support@ritelai-vision.pages.dev";
  webpush.setVapidDetails(subject,publicKey,String(privateKey));
  const calendar=await fetch(url+"/functions/v1/quick-service",{method:"POST",headers:{"Content-Type":"application/json","apikey":anon,"x-cron-secret":cronToken},body:JSON.stringify({action:"market_calendar",pushOnly:true}),signal:AbortSignal.timeout(35000)});
  if(!calendar.ok)throw new Error("Gagal mengambil kalender pasar (HTTP "+calendar.status+")");
  const payload=await calendar.json();
  if(payload.calendarError)throw new Error("Feed kalender gagal: "+String(payload.calendarError).slice(0,180));
  const now=Date.now();
  // Cron runs every five minutes. Each stage has a five-minute dispatch window
  // and a unique delivery key, so one event can send 60m, 15m and 5m reminders once each.
  const stages=[{name:"1 jam",min:55,max:60},{name:"15 menit",min:10,max:15},{name:"5 menit",min:0,max:5}];
  const events=(Array.isArray(payload.events)?payload.events:[]).filter((e:any)=>{
   const t=Date.parse(e.time),impact=String(e.importance||"").toLowerCase();
   return Number.isFinite(t)&&t>now&&impact==="high"&&String(e.name||"").trim().length>0;
  });
  let sent=0,skipped=0,failed=0;
  const {data:subs,error:subsError}=await admin.from("push_subscriptions").select("id,subscription");
  if(subsError)throw subsError;
  for(const e of events){
   const minutes=(Date.parse(e.time)-now)/60000;
   const stage=stages.find(s=>minutes<=s.max&&minutes>s.min);
   if(!stage)continue;
   const eventKey=String(e.id||e.name)+":"+String(e.time);
   const key=eventKey+":"+stage.name;
   const {data:existing,error:existingError}=await admin.from("push_event_deliveries").select("id").eq("event_key",key).maybeSingle();
   if(existingError)throw existingError;
   if(existing){skipped++;continue}
   const fmt=(v:any)=>v===null||v===undefined||String(v).trim()===""?"Belum tersedia":String(v);
   const title="🔔 RITELAI · "+String(e.name)+" · "+stage.name+" lagi";
   const bodyText=[String(e.currency||e.countryCode||"Market"),"Rilis "+new Date(e.time).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})+" WIB","Forecast: "+fmt(e.forecast),"Previous: "+fmt(e.previous),"Actual: "+fmt(e.actual)].join(" · ");
   let delivered=false;
   for(const sub of subs||[]){
    try{
     await webpush.sendNotification(sub.subscription,JSON.stringify({title,body:bodyText,url:"./?tab=news",tag:"ritelai-"+key,priority:"high"}));
     delivered=true;
    }catch(err:any){
     failed++;
     if(err?.statusCode===404||err?.statusCode===410)await admin.from("push_subscriptions").delete().eq("id",sub.id);
    }
   }
   if(delivered){
    const {error:insertError}=await admin.from("push_event_deliveries").insert({event_key:key});
    if(insertError&&insertError.code!=="23505")throw insertError;
    sent++;
   }
  }
  return reply({status:"ok",events:events.length,sent,skipped,failed,subscriptions:(subs||[]).length,calendarSource:payload.calendarSource||"unknown",stages:stages.map(s=>s.name)});
 }catch(e){return reply({error:e instanceof Error?e.message:String(e)},500)}
});