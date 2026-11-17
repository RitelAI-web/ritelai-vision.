// RitelAI Vision chart analysis. Set OPENAI_API_KEY in Supabase Function Secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});

function formatDisplay(value: unknown, depth = 0): string {
 if (value === null || value === undefined || value === "") return "Belum tersedia";
 if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
 if (depth >= 2) return "Detail tersedia";
 if (Array.isArray(value)) return value.length ? value.slice(0, 5).map((item) => formatDisplay(item, depth + 1)).join("; ") : "Belum tersedia";
 if (typeof value === "object") {
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== null && item !== undefined && item !== "");
  if (!entries.length) return "Belum tersedia";
  return entries.slice(0, 6).map(([key, item]) => {
   const labels: Record<string,string> = {support_primary:"Support utama",support_secondary:"Support berikutnya",resistance_nearest:"Resistance terdekat",resistance_secondary:"Resistance berikutnya",low:"Batas bawah",high:"Batas atas",evidence:"Bukti",touches:"Sentuhan",method:"Metode"};
   const label = labels[key] || key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();
   if (item && typeof item === "object" && !Array.isArray(item)) {
    const z = item as Record<string,unknown>;
    if (z.low != null || z.high != null) return label + ": " + (z.low ?? "?") + "–" + (z.high ?? "?") + (z.evidence != null ? " (bukti " + z.evidence + ", sentuhan " + (z.touches ?? "?") + ")" : "");
   }
   return label + ": " + formatDisplay(item, depth + 1);
  }).join(" | ");
 }
 return "Belum tersedia";
}
function scenarioOrFallback(value: unknown, side: "BUY" | "SELL", levels: Record<string, unknown>) {
 const s = value && typeof value === "object" ? value as Record<string,unknown> : {};
 const level = side === "BUY" ? levels.support_primary : levels.resistance_nearest;
 const levelText = level && typeof level === "object" ? formatDisplay(level) : "zona " + (side === "BUY" ? "support" : "resistance") + " yang teridentifikasi";
 return {
  trigger: String(s.trigger || "Tunggu harga menguji " + levelText + "; jangan entry sebelum ada reaksi yang terlihat."),
  confirmation: String(s.confirmation || "Tunggu candle konfirmasi searah skenario dan penutupan candle yang jelas."),
  entry_condition: String(s.entry_condition || "Entry hanya setelah konfirmasi; jika level dan harga tidak terbaca, jangan entry."),
  invalidation: String(s.invalidation || "Batalkan skenario jika candle close menembus zona invalidasi; level numerik hanya digunakan bila terbaca pada chart."),
  rationale: String(s.rationale || "Skenario bersyarat untuk menjaga rencana dua arah tetap tersedia; bukan sinyal entry aktif."),
  entry_price: s.entry_price != null && s.entry_price !== "" && Number.isFinite(Number(s.entry_price)) ? Number(s.entry_price) : null,
  entry_zone_low: s.entry_zone_low != null && s.entry_zone_low !== "" && Number.isFinite(Number(s.entry_zone_low)) ? Number(s.entry_zone_low) : null,
  entry_zone_high: s.entry_zone_high != null && s.entry_zone_high !== "" && Number.isFinite(Number(s.entry_zone_high)) ? Number(s.entry_zone_high) : null,
  stop_loss: s.stop_loss != null && s.stop_loss !== "" && Number.isFinite(Number(s.stop_loss)) ? Number(s.stop_loss) : null,
  take_profit_1: s.take_profit_1 != null && s.take_profit_1 !== "" && Number.isFinite(Number(s.take_profit_1)) ? Number(s.take_profit_1) : null,
  take_profit_2: s.take_profit_2 != null && s.take_profit_2 !== "" && Number.isFinite(Number(s.take_profit_2)) ? Number(s.take_profit_2) : null,
  risk_reward: s.risk_reward ?? null
 };
}

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
  const since=new Date();since.setDate(since.getDate()-30);
  const [profileResult,subResult,historyResult,freePlanResult]=await Promise.all([
   admin.from("profiles").select("role").eq("id",ud.user.id).maybeSingle(),
   admin.from("subscriptions").select("plan_id,plans(code,name,analysis_quota)").eq("user_id",ud.user.id).eq("status","active").gt("ends_at",new Date().toISOString()).order("ends_at",{ascending:false}).limit(1).maybeSingle(),
   admin.from("analysis_history").select("id",{count:"exact",head:true}).eq("user_id",ud.user.id).gte("created_at",since.toISOString()),
   admin.from("plans").select("code,name,analysis_quota").eq("code","free").eq("is_active",true).maybeSingle()
  ]);
  if(historyResult.error)throw historyResult.error;
  const profile=profileResult.data,sub=subResult.data,count=Number(historyResult.count||0);
  const planData=(sub?.plans as any)||freePlanResult.data||{};
  const planCode=String(planData.code||"free").toLowerCase();
  const isAdmin=["owner","admin","super_admin"].includes(String(profile?.role||"").toLowerCase());
  const planName=String(planData.name||(planCode==="free"?"Gratis":planCode));
  const quota=planCode==="free"?5:planCode==="starter"?20:Number(planData.analysis_quota||0);
  if(body?.action==="quota_status")return reply({quota:{planCode,planName,total:quota,used:count,remaining:Math.max(0,quota-count),periodLabel:"30 hari"}});
  if(!profile)return reply({error:"Profil akun belum tersedia. Hubungi Admin."},403);
  if(!isAdmin&&quota<=0)return reply({error:"Kuota paket belum dikonfigurasi. Hubungi Admin."},403);
  if(!isAdmin&&count>=quota)return reply({error:`Kuota paket ${planName} habis (${count}/${quota} analisis dalam 30 hari).`},403);
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
9. Analisis indikator secara TERPISAH dan beri keputusan BUY/SELL/WAIT beserta alasan untuk masing-masing. Periksa EMA 9/20/50/200 (posisi harga, kemiringan, susunan/ribbon dan cross), Parabolic SAR (titik di atas/bawah candle dan perubahan sisi), RSI 14 (zona 30/50/70 dan divergence hanya bila swing terlihat), MACD (line/signal cross dan histogram), ADX/DMI (kekuatan trend dan +DI/-DI), Bollinger Bands (squeeze, expansion, posisi band), VWAP (posisi harga terhadap VWAP dan reclaim/rejection bila garis terlihat), Stochastic RSI (cross %K/%D dan zona ekstrem bila panel terbaca), ATR (volatilitas untuk jarak SL, bukan arah), serta volume (konfirmasi bila panel volume tersedia). PENTING: screenshot harus benar-benar memperlihatkan indikator/panel/angka untuk menyimpulkan indikator itu. Jika tidak terlihat atau tidak dapat dibaca, status="UNAVAILABLE", signal="WAIT", reason jelaskan data tidak tampak; jangan mengarang nilai. Jangan mengklaim indikator dihitung dari chart polos. Untuk setiap indikator keluarkan objek {name,status,signal,reading,reason}. Berikan juga indicator_consensus {buy_count,sell_count,wait_count,available_count,overall,reason}. Consensus hanya menghitung indikator AVAILABLE; ATR bukan indikator arah dan tidak dihitung sebagai BUY/SELL. Jangan anggap semua indikator independen.
10. Jika chart blur, skala tidak terbaca, atau timeframe/simbol tidak jelas, turunkan confidence dan pilih WAIT.

PENDING ORDER WAJIB:
Evaluasi buy_limit dan sell_limit secara independen. BUY_LIMIT hanya pada zona support/demand yang benar-benar terlihat; SELL_LIMIT hanya pada resistance/supply yang terlihat. Setiap rencana berisi status VALID_SETUP/WAIT_CONFIRMATION/NOT_VALID, entry_price, entry_zone_low/high, stop_loss, take_profit_1/2, risk_reward, zone_type, rationale, evidence, invalidation, confidence_score 0-100. Confidence_score adalah skor kualitas bukti setup, BUKAN probabilitas profit atau akurasi. historical_accuracy_pct wajib null sampai hasil backtest/forward test terverifikasi. Jangan memaksakan limit: jika level tidak terbaca, RR tidak masuk akal, atau bukti kurang, semua harga null dan status WAIT_CONFIRMATION/NOT_VALID. Jelaskan no_trade_reason. Jangan entry limit tanpa menjelaskan risiko harga menyentuh zona lalu menembusnya.
FIELD JSON WAJIB:
signal (BUY/SELL/WAIT), summary (2-4 kalimat, sebut struktur dan kondisi), trend (UPTREND/DOWNTREND/SIDEWAYS/UNCLEAR), market_structure, swing_points (array objek {type, price, evidence}; maksimal 8), support_resistance (objek {support_primary, support_secondary, resistance_nearest, resistance_secondary, method}), setup_type (BREAKOUT/RETEST/REJECTION/PULLBACK/REVERSAL/NONE), entry, entry_zone, entry_trigger, stop_loss, take_profit_1, take_profit_2, risk_reward, invalidation, confidence, supporting_evidence (array), opposing_evidence (array), confirmation (array), warnings (array), scenario_buy dan scenario_sell (masing-masing objek {trigger, confirmation, entry_condition, invalidation, rationale, entry_price, entry_zone_low, entry_zone_high, stop_loss, take_profit_1, take_profit_2, risk_reward}). Isi harga entry, SL dan TP hanya bila level dapat dibaca/dihitung wajar dari struktur chart; selain itu null. entry_price adalah level entry rencana berdasarkan snapshot chart, BUKAN harga market live. Skenario BUY memakai pemicu breakout/retest; SELL memakai rejection/breakdown. Harga entry SELL wajib ditampilkan sama seperti BUY bila terbaca; jangan menyalin harga BUY ke SELL., pending_orders (objek {buy_limit, sell_limit, no_trade_reason}), chart_price_status, chart_timestamp, indicator_signals (array {name,status,signal,reading,reason}), indicator_consensus ({buy_count,sell_count,wait_count,available_count,overall,reason}), rsi, macd, volume, volatility, reasoning, disclaimer.
Semua angka harga harus bersumber dari screenshot. Untuk level yang tidak terbaca gunakan null. chart_price_status harus snapshot_only. Jangan berikan janji profit.`;;

   const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:image,detail:"high"}]}],text:{format:{type:"json_object"}},max_output_tokens:3000})});
  const raw=await res.json();if(!res.ok){const apiMessage=raw?.error?.message||`OpenAI HTTP ${res.status}`;throw new Error(`OpenAI HTTP ${res.status}: ${apiMessage}`);}
  if(raw.status==="incomplete")throw new Error(`OpenAI incomplete response: ${raw.incomplete_details?.reason||"output limit"}`);
  const txt=String(raw.output_text||(raw.output||[]).flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text).join("\n")).replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
  if(!txt)throw new Error("OpenAI returned an empty analysis response.");
  let result:any;try{result=JSON.parse(txt);}catch(_){throw new Error("OpenAI response was not valid JSON.");}
  if(!result||typeof result!=="object")throw new Error("OpenAI returned an invalid analysis object.");
  if(!["BUY","SELL","WAIT"].includes(String(result.signal).toUpperCase()))result.signal="WAIT";
  if(!["UPTREND","DOWNTREND","SIDEWAYS","UNCLEAR"].includes(String(result.trend||"").toUpperCase()))result.trend="UNCLEAR";
  const arr=(v:any)=>Array.isArray(v)?v.map((x:any)=>String(x)).slice(0,8):[];
  const makeOrder=(v:any,side:"BUY_LIMIT"|"SELL_LIMIT")=>{const x=v&&typeof v==="object"?v:{};const num=(k:string)=>x[k]!==null&&x[k]!==undefined&&x[k]!==""&&Number.isFinite(Number(x[k]))?Number(x[k]):null;const st=["VALID_SETUP","WAIT_CONFIRMATION","NOT_VALID"].includes(String(x.status||"").toUpperCase())?String(x.status).toUpperCase():"WAIT_CONFIRMATION";const z=["SUPPORT","DEMAND","RESISTANCE","SUPPLY","RETEST","UNAVAILABLE"].includes(String(x.zone_type||"").toUpperCase())?String(x.zone_type).toUpperCase():"UNAVAILABLE";const sc=Number(x.confidence_score);return {order_type:side,status:st,entry_price:num("entry_price"),entry_zone_low:num("entry_zone_low"),entry_zone_high:num("entry_zone_high"),stop_loss:num("stop_loss"),take_profit_1:num("take_profit_1"),take_profit_2:num("take_profit_2"),risk_reward:x.risk_reward??null,zone_type:z,rationale:String(x.rationale||"Bukti zona belum cukup."),evidence:arr(x.evidence),invalidation:String(x.invalidation||"Batalkan jika struktur zona ditembus candle konfirmasi."),confidence_score:Number.isFinite(sc)?Math.max(0,Math.min(100,Math.round(sc))):0,historical_accuracy_pct:null};};
  const orders=result.pending_orders&&typeof result.pending_orders==="object"?result.pending_orders:{};
  const pendingOrders={buy_limit:makeOrder(orders.buy_limit,"BUY_LIMIT"),sell_limit:makeOrder(orders.sell_limit,"SELL_LIMIT"),no_trade_reason:String(orders.no_trade_reason||"Tidak ada order jika bukti zona dan level belum memadai.")};
  const {error:historyInsertError}=await admin.from("analysis_history").insert({user_id:ud.user.id,asset:instrument,timeframe,result:{signal:result.signal,summary:result.summary,confidence:result.confidence,trend:result.trend}});if(historyInsertError)throw historyInsertError;const conf=Number(result.confidence); const sr=result.support_resistance&&typeof result.support_resistance==="object"?result.support_resistance:{}; const scenarioBuy=scenarioOrFallback(result.scenario_buy,"BUY",sr); const scenarioSell=scenarioOrFallback(result.scenario_sell,"SELL",sr); return reply({result:{signal:String(result.signal).toUpperCase(),summary:String(result.summary||"Analisis selesai."),entry:result.entry??null,stop_loss:result.stop_loss??null,scenario_buy:scenarioBuy,scenario_sell:scenarioSell,pending_orders:pendingOrders,take_profit_1:result.take_profit_1??result.take_profit??null,take_profit:result.take_profit_1??result.take_profit??null,take_profit_2:result.take_profit_2??null,risk_reward:result.risk_reward??null,confidence:Number.isFinite(conf)?Math.max(0,Math.min(100,conf)):0,trend:result.trend??"UNCLEAR",support_resistance:formatDisplay(result.support_resistance),support_resistance_detail:result.support_resistance??null,market_structure:result.market_structure??null,swing_points:Array.isArray(result.swing_points)?result.swing_points.slice(0,8):[],setup_type:result.setup_type??"NONE",entry_zone:result.entry_zone??null,entry_trigger:result.entry_trigger??null,invalidation:result.invalidation??null,supporting_evidence:arr(result.supporting_evidence),opposing_evidence:arr(result.opposing_evidence),chart_price_status:"snapshot_only",chart_timestamp:result.chart_timestamp??null,indicator_signals:Array.isArray(result.indicator_signals)?result.indicator_signals.slice(0,12):[],indicator_consensus:result.indicator_consensus&&typeof result.indicator_consensus==="object"?result.indicator_consensus:null,rsi:formatDisplay(result.rsi),rsi_detail:result.rsi??null,macd:formatDisplay(result.macd),macd_detail:result.macd??null,volume:formatDisplay(result.volume),volume_detail:result.volume??null,volatility:formatDisplay(result.volatility),volatility_detail:result.volatility??null,reasoning:result.reasoning??result.summary??null,confirmation:arr(result.confirmation),warnings:arr(result.warnings),disclaimer:result.disclaimer??"Analisis hanya berdasarkan screenshot (snapshot), bukan harga live. Verifikasi harga dan level di broker sebelum entry. Bukan jaminan profit."}});
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