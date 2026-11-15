// RitelAI Vision chart analysis. Set OPENAI_API_KEY in Supabase Function Secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"Method tidak didukung."},405);
 try{
  const auth=req.headers.get("Authorization")||""; if(!auth.startsWith("Bearer "))return reply({error:"Silakan login terlebih dahulu."},401);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,key=Deno.env.get("OPENAI_API_KEY");
  if(!url||!anon||!service||!key)return reply({error:"Layanan AI belum dikonfigurasi di Supabase Secrets."},503);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:ud,error:ue}=await userClient.auth.getUser(); if(ue||!ud.user)return reply({error:"Sesi login tidak valid."},401);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:profile}=await admin.from("profiles").select("role").eq("id",ud.user.id).maybeSingle();
  const {data:sub}=await admin.from("subscriptions").select("plan_id,plans(name,analysis_quota)").eq("user_id",ud.user.id).eq("status","active").gt("ends_at",new Date().toISOString()).order("ends_at",{ascending:false}).limit(1).maybeSingle();
  let quota=Number((sub?.plans as any)?.analysis_quota??0),planName=String((sub?.plans as any)?.name??"");
  if(!sub){const {data:free}=await admin.from("plans").select("name,analysis_quota").eq("code","free").eq("is_active",true).maybeSingle();quota=Number(free?.analysis_quota??0);planName=String(free?.name??"Free");}
  const since=new Date();since.setDate(since.getDate()-30);
  const {count,error:ce}=await admin.from("analysis_history").select("id",{count:"exact",head:true}).eq("user_id",ud.user.id).gte("created_at",since.toISOString());if(ce)throw ce;
  if(!profile||(!["owner","admin"].includes(profile.role)&&quota>0&&(count??0)>=quota))return reply({error:`Kuota paket ${planName||"akun"} habis (${count}/${quota} analisis dalam 30 hari).`},403);
  const body=await req.json(),image=String(body?.image||""),instrument=String(body?.instrument||"XAUUSD").slice(0,24),timeframe=String(body?.timeframe||"M15").slice(0,12),risk=Number(body?.risk);
  if(!/^data:image\/(png|jpeg|webp);base64,/.test(image)||image.length>9000000)return reply({error:"Gambar tidak valid atau terlalu besar."},400);
  if(!Number.isFinite(risk)||risk<=0||risk>2)return reply({error:"Risiko harus di atas 0% dan maksimal 2%."},400);
  const prompt=`Analisis screenshot chart untuk edukasi, bukan nasihat keuangan. Instrumen ${instrument}; timeframe ${timeframe}; batas risiko ${risk}%. Jika harga atau skala tidak terbaca jelas, signal WAIT dan level null. Jangan mengarang harga. Kembalikan JSON valid: signal (BUY/SELL/WAIT), summary, entry, stop_loss, take_profit, indicators (array), risk_note, confidence_label. Confidence bukan win rate atau probabilitas profit. Jangan menjanjikan profit.`;
  const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:image,detail:"high"}]}],max_output_tokens:900})});
  const raw=await res.json();if(!res.ok)throw new Error(raw?.error?.message||`OpenAI HTTP ${res.status}`);
  const txt=(raw.output||[]).flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text).join("\n").replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
  const result=JSON.parse(txt);if(!["BUY","SELL","WAIT"].includes(String(result.signal).toUpperCase()))result.signal="WAIT";
  const {error:se}=await admin.from("analysis_history").insert({user_id:ud.user.id,asset:instrument,timeframe,result});if(se)throw se;
  return reply({result:{signal:String(result.signal).toUpperCase(),summary:String(result.summary||"Analisis selesai."),entry:result.entry??null,stop_loss:result.stop_loss??null,take_profit:result.take_profit??null,indicators:Array.isArray(result.indicators)?result.indicators:[],risk_note:result.risk_note??"Gunakan stop loss; hasil AI dapat keliru.",confidence_label:result.confidence_label??"Tidak dinilai"}});
 }catch(e){console.error("quick-handler",e);return reply({error:e instanceof Error?e.message:"Analisis gagal."},500);}
});