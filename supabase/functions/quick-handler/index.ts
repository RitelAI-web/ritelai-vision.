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
  const prompt=`Anda adalah analis teknikal profesional untuk RitelAI Vision. Analisis HANYA bukti yang benar-benar terlihat pada screenshot. Instrumen ${instrument}; timeframe ${timeframe}; risiko maksimum ${risk}% per transaksi. Jawab JSON valid saja dalam Bahasa Indonesia.

PROSEDUR WAJIB:
1. Baca struktur swing: tandai minimal dua swing high dan dua swing low yang terlihat bila memungkinkan. Klasifikasikan HH/HL, LH/LL, atau range. Jangan simpulkan trend hanya dari satu candle. Jika swing tidak cukup jelas, trend=UNCLEAR dan confidence rendah.
2. Petakan SUPPORT/RESISTANCE dari zona reaksi harga yang berulang (minimal dua reaksi terpisah jika memungkinkan), bukan hanya harga candle terakhir atau satu wick. Kembalikan zona sebagai {low, high, evidence, touches}; low/high hanya angka yang terbaca dari skala chart. Pisahkan support utama, support berikutnya, resistance terdekat, resistance berikutnya. Bila tidak terbaca, null. Jangan menyebut harga terakhir sebagai support tanpa bukti reaksi.
3. Bedakan kondisi:
   - BREAKOUT hanya setelah candle close melewati zona; wick saja bukan breakout.
   - RETEST setelah breakout dan harga kembali menguji zona dari sisi seberang.
   - REJECTION bila harga menyentuh zona lalu candle close menjauh dengan bukti candle yang tampak.
   - PULLBACK adalah koreksi melawan trend utama, bukan otomatis reversal.
   - REVERSAL memerlukan perubahan struktur (misalnya break swing dan terbentuk HH/HL atau LH/LL baru) plus konfirmasi.
4. Pisahkan trend dari keputusan entry. BUY/SELL hanya bila setup dan candle konfirmasi terlihat jelas. Jika belum, signal=WAIT. Jangan mengejar candle impulsif yang sudah memanjang. Pada WAIT, tetap buat scenario_buy dan scenario_sell bersyarat, tidak boleh menyuruh entry sekarang.
5. Setup BUY/SELL yang valid wajib menyediakan entry_zone, entry_trigger, stop_loss, take_profit_1, take_profit_2, risk_reward, alasan invalidasi. SL ditempatkan melewati struktur/zona invalidasi, bukan angka acak. TP mengacu swing/zona berikutnya yang terlihat. Jika angka tidak terbaca atau RR tidak masuk akal, nilai numerik null dan signal WAIT.
6. Risiko dan ukuran posisi: jangan hitung lot jika contract size, nilai tick, dan mata uang akun tidak tersedia. Tampilkan risiko maksimum pengguna ${risk}% saja; bukan rekomendasi ukuran lot.
7. Confidence adalah tingkat kejelasan bukti visual (0-100), bukan probabilitas profit/win rate. Sebutkan bukti yang mendukung dan menentang skenario utama.
8. Harga dari screenshot adalah DATA SNAPSHOT, bukan harga live. Jangan klaim real-time, streaming, sinkron broker, atau menyatakan harga masih berlaku. Kembalikan chart_price_status="snapshot_only", chart_timestamp hanya jika terbaca; bila tidak terbaca null. Minta pengguna verifikasi harga terkini di broker sebelum entry.
9. Analisis indikator secara TERPISAH dan beri keputusan BUY/SELL/WAIT beserta alasan untuk masing-masing. Periksa EMA 9/20/50/200 (posisi harga, kemiringan, susunan/ribbon dan cross), Parabolic SAR (titik di atas/bawah candle dan perubahan sisi), RSI 14 (zona 30/50/70 dan divergence hanya bila swing terlihat), MACD (line/signal cross dan histogram), ADX/DMI (kekuatan trend dan +DI/-DI), Bollinger Bands (squeeze, expansion, posisi band), ATR (volatilitas untuk jarak SL, bukan arah), serta volume (konfirmasi bila panel volume tersedia). PENTING: screenshot harus benar-benar memperlihatkan indikator/panel/angka untuk menyimpulkan indikator itu. Jika tidak terlihat atau tidak dapat dibaca, status="UNAVAILABLE", signal="WAIT", reason jelaskan data tidak tampak; jangan mengarang nilai. Jangan mengklaim indikator dihitung dari chart polos. Untuk setiap indikator keluarkan objek {name,status,signal,reading,reason}. Berikan juga indicator_consensus {buy_count,sell_count,wait_count,available_count,overall,reason}. Consensus hanya menghitung indikator AVAILABLE; ATR bukan indikator arah dan tidak dihitung sebagai BUY/SELL. Jangan anggap semua indikator independen.
10. Jika chart blur, skala tidak terbaca, atau timeframe/simbol tidak jelas, turunkan confidence dan pilih WAIT.

FIELD JSON WAJIB:
signal (BUY/SELL/WAIT), summary (2-4 kalimat, sebut struktur dan kondisi), trend (UPTREND/DOWNTREND/SIDEWAYS/UNCLEAR), market_structure, swing_points (array objek {type, price, evidence}; maksimal 8), support_resistance (objek {support_primary, support_secondary, resistance_nearest, resistance_secondary, method}), setup_type (BREAKOUT/RETEST/REJECTION/PULLBACK/REVERSAL/NONE), entry, entry_zone, entry_trigger, stop_loss, take_profit_1, take_profit_2, risk_reward, invalidation, confidence, supporting_evidence (array), opposing_evidence (array), confirmation (array), warnings (array), scenario_buy (objek {trigger, confirmation, entry_condition, invalidation, rationale}), scenario_sell (objek {trigger, confirmation, entry_condition, invalidation, rationale}), chart_price_status, chart_timestamp, indicator_signals (array {name,status,signal,reading,reason}), indicator_consensus ({buy_count,sell_count,wait_count,available_count,overall,reason}), rsi, macd, volume, volatility, reasoning, disclaimer.
Semua angka harga harus bersumber dari screenshot. Untuk level yang tidak terbaca gunakan null. chart_price_status harus snapshot_only. Jangan berikan janji profit.`;;

   const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:image,detail:"high"}]}],text:{format:{type:"json_object"}},max_output_tokens:2200})});
  const raw=await res.json();if(!res.ok){const apiMessage=raw?.error?.message||`OpenAI HTTP ${res.status}`;throw new Error(`OpenAI HTTP ${res.status}: ${apiMessage}`);}
  if(raw.status==="incomplete")throw new Error(`OpenAI incomplete response: ${raw.incomplete_details?.reason||"output limit"}`);
  const txt=String(raw.output_text||(raw.output||[]).flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text).join("\n")).replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
  if(!txt)throw new Error("OpenAI returned an empty analysis response.");
  let result:any;try{result=JSON.parse(txt);}catch(_){throw new Error("OpenAI response was not valid JSON.");}
  if(!result||typeof result!=="object")throw new Error("OpenAI returned an invalid analysis object.");
  if(!["BUY","SELL","WAIT"].includes(String(result.signal).toUpperCase()))result.signal="WAIT";
  if(!["UPTREND","DOWNTREND","SIDEWAYS","UNCLEAR"].includes(String(result.trend||"").toUpperCase()))result.trend="UNCLEAR";
  const arr=(v:any)=>Array.isArray(v)?v.map((x:any)=>String(x)).slice(0,8):[]; const conf=Number(result.confidence); return reply({result:{signal:String(result.signal).toUpperCase(),summary:String(result.summary||"Analisis selesai."),entry:result.entry??null,stop_loss:result.stop_loss??null,scenario_buy:result.scenario_buy&&typeof result.scenario_buy==="object"?result.scenario_buy:null,scenario_sell:result.scenario_sell&&typeof result.scenario_sell==="object"?result.scenario_sell:null,take_profit_1:result.take_profit_1??result.take_profit??null,take_profit:result.take_profit_1??result.take_profit??null,take_profit_2:result.take_profit_2??null,risk_reward:result.risk_reward??null,confidence:Number.isFinite(conf)?Math.max(0,Math.min(100,conf)):0,trend:result.trend??null,support_resistance:result.support_resistance??null,market_structure:result.market_structure??null,swing_points:Array.isArray(result.swing_points)?result.swing_points.slice(0,8):[],setup_type:result.setup_type??"NONE",entry_zone:result.entry_zone??null,entry_trigger:result.entry_trigger??null,invalidation:result.invalidation??null,supporting_evidence:arr(result.supporting_evidence),opposing_evidence:arr(result.opposing_evidence),scenario_buy:result.scenario_buy&&typeof result.scenario_buy==="object"?result.scenario_buy:null,scenario_sell:result.scenario_sell&&typeof result.scenario_sell==="object"?result.scenario_sell:null,chart_price_status:"snapshot_only",chart_timestamp:result.chart_timestamp??null,indicator_signals:Array.isArray(result.indicator_signals)?result.indicator_signals.slice(0,10):[],indicator_consensus:result.indicator_consensus&&typeof result.indicator_consensus==="object"?result.indicator_consensus:null,rsi:result.rsi??null,macd:result.macd??null,volume:result.volume??null,volatility:result.volatility??null,reasoning:result.reasoning??result.summary??null,confirmation:arr(result.confirmation),warnings:arr(result.warnings),disclaimer:result.disclaimer??"Analisis hanya berdasarkan screenshot (snapshot), bukan harga live. Verifikasi harga dan level di broker sebelum entry. Bukan jaminan profit."}});
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