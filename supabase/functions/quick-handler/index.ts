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
  if(!profile||(!["owner","admin","super_admin"].includes(String(profile.role||"").toLowerCase())&&(count??0)>=quota))return reply({error:`Kuota paket ${planName||"akun"} habis (${count}/${quota} analisis dalam 30 hari).`},403);
  const body=await req.json(),image=String(body?.image||""),instrument=String(body?.instrument||"XAUUSD").slice(0,24),timeframe=String(body?.timeframe||"M15").slice(0,12),risk=Number(body?.risk);
  if(!/^data:image\/(png|jpeg|webp);base64,/.test(image)||image.length>9000000)return reply({error:"Gambar tidak valid atau terlalu besar."},400);
  if(!Number.isFinite(risk)||risk<=0||risk>2)return reply({error:"Risiko harus di atas 0% dan maksimal 2%."},400);
  const prompt=`Anda adalah analis teknikal chart yang disiplin. Analisis gambar chart yang benar-benar terlihat; jangan menebak data yang tidak tampak. Instrumen ${instrument}; timeframe ${timeframe}; risiko maksimum ${risk}% per transaksi. Kembalikan JSON valid saja.

ATURAN ANALISIS:
1) Baca struktur harga terlebih dahulu: rangkaian swing high/swing low, arah candle terakhir, posisi harga terhadap support/resistance, dan apakah ada breakout/rejection yang benar-benar terlihat.
2) Tentukan TREND secara independen dari keputusan ENTRY:
- UPTREND bila swing high dan swing low cenderung makin tinggi.
- DOWNTREND bila swing high dan swing low cenderung makin rendah.
- SIDEWAYS hanya bila harga jelas berulang kali tertahan dalam rentang horizontal tanpa struktur naik/turun dominan.
- UNCLEAR bila gambar/struktur tidak cukup terbaca.
Jangan menyebut SIDEWAYS hanya karena belum ada sinyal entry. Tren bisa UPTREND/DOWNTREND sementara signal tetap WAIT.
3) Tentukan SIGNAL terpisah:
- BUY hanya bila ada setup bullish yang terlihat dan terkonfirmasi (contoh higher-low lalu candle bullish konfirmasi, rejection support, atau breakout diikuti close/retest).
- SELL hanya bila ada setup bearish yang terlihat dan terkonfirmasi (contoh lower-high lalu candle bearish konfirmasi, rejection resistance, atau breakdown diikuti close/retest).
- WAIT bila entry belum terkonfirmasi, harga berada di tengah range, atau chart tidak cukup terbaca. Jangan memaksakan BUY/SELL.
4) Jangan mengarang harga, level, indikator, volume, maupun pola. Jika skala harga tidak terbaca, isi level terkait null. RSI/MACD hanya isi bila indikatornya tampak dan nilainya dapat dibaca; jika tidak, null atau "Tidak terlihat". Volume hanya nilai bila panel volume tampak.
5) Untuk range, sebutkan batas atas/bawah hanya jika dapat dibaca. Untuk tren, jelaskan struktur swing yang mendukung. Summary wajib spesifik terhadap gambar, bukan template umum.
6) Entry/SL/TP/RR hanya isi jika setup terkonfirmasi dan angka dapat dibaca/dihitung dari chart. Jika tidak, null. Confidence mengukur kejelasan bukti visual (0-100), BUKAN probabilitas profit atau win rate.
7) Sebutkan alasan yang menentang skenario utama dan kondisi yang membatalkan setup. Dilarang menjanjikan profit.\n8) WALAU signal WAIT, isi dua skenario bersyarat scenario_buy dan scenario_sell. Masing-masing berisi trigger (harga/level pemicu hanya jika terbaca; selain itu null), confirmation (apa yang harus terjadi sebelum entry), invalidation (level/kondisi pembatalan hanya jika terbaca; selain itu null), dan rationale. Jangan jadikan trigger sebagai entry sekarang. Jika harga pada chart tidak terbaca, trigger dan invalidation null tetapi confirmation/rationale tetap spesifik terhadap struktur yang tampak.

FIELD JSON:
signal (BUY/SELL/WAIT), summary (bahasa Indonesia, 2-4 kalimat, sebutkan bukti candle/struktur yang terlihat), entry, stop_loss, take_profit_1, take_profit_2, risk_reward, confidence (0-100), trend (UPTREND/DOWNTREND/SIDEWAYS/UNCLEAR), support_resistance, rsi, macd, volume, volatility, reasoning, confirmation (array), warnings (array), disclaimer.
Gunakan null untuk angka/level yang tidak bisa dipastikan. Jangan gunakan angka harga contoh atau harga pasar dari ingatan; semua level harus berasal dari gambar. `;

   const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:image,detail:"high"}]}],text:{format:{type:"json_object"}},max_output_tokens:1400})});
  const raw=await res.json();if(!res.ok){const apiMessage=raw?.error?.message||`OpenAI HTTP ${res.status}`;throw new Error(`OpenAI HTTP ${res.status}: ${apiMessage}`);}
  if(raw.status==="incomplete")throw new Error(`OpenAI incomplete response: ${raw.incomplete_details?.reason||"output limit"}`);
  const txt=String(raw.output_text||(raw.output||[]).flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text).join("\n")).replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
  if(!txt)throw new Error("OpenAI returned an empty analysis response.");
  let result:any;try{result=JSON.parse(txt);}catch(_){throw new Error("OpenAI response was not valid JSON.");}
  if(!result||typeof result!=="object")throw new Error("OpenAI returned an invalid analysis object.");
  if(!["BUY","SELL","WAIT"].includes(String(result.signal).toUpperCase()))result.signal="WAIT";
  if(!["UPTREND","DOWNTREND","SIDEWAYS","UNCLEAR"].includes(String(result.trend||"").toUpperCase()))result.trend="UNCLEAR";
  const arr=(v:any)=>Array.isArray(v)?v.map((x:any)=>String(x)).slice(0,8):[]; const conf=Number(result.confidence); return reply({result:{signal:String(result.signal).toUpperCase(),summary:String(result.summary||"Analisis selesai."),entry:result.entry??null,stop_loss:result.stop_loss??null,scenario_buy:result.scenario_buy&&typeof result.scenario_buy==="object"?result.scenario_buy:null,scenario_sell:result.scenario_sell&&typeof result.scenario_sell==="object"?result.scenario_sell:null,take_profit_1:result.take_profit_1??result.take_profit??null,take_profit:result.take_profit_1??result.take_profit??null,take_profit_2:result.take_profit_2??null,risk_reward:result.risk_reward??null,confidence:Number.isFinite(conf)?Math.max(0,Math.min(100,conf)):0,trend:result.trend??null,support_resistance:result.support_resistance??null,rsi:result.rsi??null,macd:result.macd??null,volume:result.volume??null,volatility:result.volatility??null,reasoning:result.reasoning??result.summary??null,confirmation:arr(result.confirmation),warnings:arr(result.warnings),disclaimer:result.disclaimer??"Analisis berdasarkan screenshot, bukan data harga live atau jaminan hasil. Periksa kondisi pasar sebelum mengambil keputusan."}});
 }catch(e){
  console.error("quick-handler",e);
  const raw=e instanceof Error?e.message:"Kesalahan internal saat analisis.";
  const safe=raw.includes("OPENAI_API_KEY")?"Kunci AI belum dipasang di Supabase > Edge Functions > Secrets (OPENAI_API_KEY).":
   /OpenAI HTTP 401|Incorrect API key|invalid_api_key/i.test(raw)?"Kunci OpenAI tidak valid atau tidak memiliki akses. Periksa OPENAI_API_KEY di Supabase Secrets.":
   /OpenAI HTTP 429|quota|billing/i.test(raw)?"Kuota atau billing API OpenAI habis. Periksa penggunaan dan billing akun OpenAI.":
   /OpenAI HTTP 5\d\d|fetch failed|connection/i.test(raw)?"Layanan AI sedang tidak dapat dihubungi. Coba lagi nanti.":
   /analysis_history|profiles|subscriptions|plans/i.test(raw)?"Database Supabase menolak proses analisis. Periksa tabel, kolom, dan izin service role.":
   raw.slice(0,500);
  return reply({error:safe,code:"ANALYSIS_FAILED"},500);
 }
});