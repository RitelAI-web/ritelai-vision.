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
 const num=(v:unknown)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):null;
 const entry=num(s.entry_price),sl=num(s.stop_loss),tp1=num(s.take_profit_1),tp2=num(s.take_profit_2);
 const risk=entry!==null&&sl!==null?Math.abs(entry-sl):0;
 const reward=entry!==null&&tp1!==null?(side==="BUY"?tp1-entry:entry-tp1):0;
 const directionValid=entry!==null&&sl!==null&&tp1!==null&&(side==="BUY"?(sl<entry&&tp1>entry):(sl>entry&&tp1<entry));
 const rr=directionValid&&risk>0&&reward>0?Number((reward/risk).toFixed(2)):null;
 const levelCheck=entry!==null&&sl!==null&&tp1!==null&&directionValid&&rr!==null;
 return {
  trigger: String(s.trigger || "Tunggu harga menguji " + levelText + "; jangan entry sebelum ada reaksi yang terlihat."),
  confirmation: String(s.confirmation || "Tunggu candle konfirmasi searah skenario dan penutupan candle yang jelas."),
  entry_condition: String(s.entry_condition || "Entry hanya setelah konfirmasi; jika level dan harga tidak terbaca, jangan entry."),
  invalidation: String(s.invalidation || "Batalkan skenario jika candle close menembus zona invalidasi; level numerik hanya digunakan bila terbaca pada chart."),
  rationale: String(s.rationale || "Skenario bersyarat untuk menjaga rencana dua arah tetap tersedia; bukan sinyal entry aktif.")+(levelCheck&&rr!<1.5?" RR dihitung ulang oleh server dan di bawah 1.5; setup belum layak entry.":""),
  entry_price: entry,
  entry_zone_low: num(s.entry_zone_low),
  entry_zone_high: num(s.entry_zone_high),
  stop_loss: sl,
  take_profit_1: tp1,
  take_profit_2: tp2,
  risk_reward: rr,
  setup_status: !levelCheck?"WAIT_CONFIRMATION":rr!<1.5?"NOT_VALID":"VALID_SETUP"
 };
}


type Candle = {openTime:string;open:number;high:number;low:number;close:number;volume:number;tickVolume:number;isOpen:boolean};
function ema(v:number[],p:number):number|null{if(v.length<p)return null;const k=2/(p+1);let x=v.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<v.length;i++)x=v[i]*k+x*(1-k);return +x.toFixed(8)}
function rsi(v:number[],p=14):number|null{if(v.length<=p)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d)}g/=p;l/=p;for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(0,d))/p;l=(l*(p-1)+Math.max(0,-d))/p}return l===0?100:+(100-100/(1+g/l)).toFixed(2)}
function atr(b:Candle[],p=14):number|null{if(b.length<=p)return null;const t:number[]=[];for(let i=1;i<b.length;i++)t.push(Math.max(b[i].high-b[i].low,Math.abs(b[i].high-b[i-1].close),Math.abs(b[i].low-b[i-1].close)));let a=t.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<t.length;i++)a=(a*(p-1)+t[i])/p;return +a.toFixed(8)}
function calcAdx(b:Candle[],p=14):number|null{
 if(b.length<p*2+1)return null;let tr=0,plus=0,minus=0;
 for(let i=1;i<=p;i++){const up=b[i].high-b[i-1].high,down=b[i-1].low-b[i].low;tr+=Math.max(b[i].high-b[i].low,Math.abs(b[i].high-b[i-1].close),Math.abs(b[i].low-b[i-1].close));plus+=up>down&&up>0?up:0;minus+=down>up&&down>0?down:0}
 let atr=tr/p,pdm=plus/p,mdm=minus/p,dxs:number[]=[];
 const dx=()=>{const pdi=atr?100*pdm/atr:0,mdi=atr?100*mdm/atr:0;return pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0};
 dxs.push(dx());
 for(let i=p+1;i<b.length;i++){const up=b[i].high-b[i-1].high,down=b[i-1].low-b[i].low;const trNow=Math.max(b[i].high-b[i].low,Math.abs(b[i].high-b[i-1].close),Math.abs(b[i].low-b[i-1].close));atr=(atr*(p-1)+trNow)/p;pdm=(pdm*(p-1)+(up>down&&up>0?up:0))/p;mdm=(mdm*(p-1)+(down>up&&down>0?down:0))/p;dxs.push(dx())}
 if(dxs.length<p)return null;let a=dxs.slice(0,p).reduce((x,y)=>x+y,0)/p;for(let i=p;i<dxs.length;i++)a=(a*(p-1)+dxs[i])/p;return +a.toFixed(2)
}
function calcPsar(b:Candle[]){
 if(b.length<3)return null;let bull=b[1].close>=b[0].close,af=0.02,ep=bull?Math.max(b[0].high,b[1].high):Math.min(b[0].low,b[1].low),sar=bull?Math.min(b[0].low,b[1].low):Math.max(b[0].high,b[1].high);
 for(let i=2;i<b.length;i++){let next=sar+af*(ep-sar);if(bull){next=Math.min(next,b[i-1].low,b[i-2].low);if(b[i].low<next){bull=false;next=ep;ep=b[i].low;af=0.02}else if(b[i].high>ep){ep=b[i].high;af=Math.min(0.2,af+0.02)}}else{next=Math.max(next,b[i-1].high,b[i-2].high);if(b[i].high>next){bull=true;next=ep;ep=b[i].high;af=0.02}else if(b[i].low<ep){ep=b[i].low;af=Math.min(0.2,af+0.02)}}sar=next}
 return {value:+sar.toFixed(8),bias:bull?"BUY":"SELL"}
}
function technical(b:Candle[]){const c=b.map(x=>x.close),last=b[b.length-1],e20=ema(c,20),e50=ema(c,50),f=c.map((_,i)=>ema(c.slice(0,i+1),12)),s=c.map((_,i)=>ema(c.slice(0,i+1),26)),ml=f.map((x,i)=>x===null||s[i]===null?null:x-s[i]).filter((x):x is number=>x!==null),macd=ml.length?ml[ml.length-1]:null,sig=ml.length>=9?ema(ml,9):null,mean=c.length>=20?c.slice(-20).reduce((a,x)=>a+x,0)/20:null,sd=mean===null?null:Math.sqrt(c.slice(-20).reduce((a,x)=>a+(x-mean)**2,0)/20);return{lastClose:last.close,ema:{ema9:ema(c,9),ema20:e20,ema50:e50,ema200:ema(c,200)},rsi14:rsi(c),macd:{line:macd===null?null:+macd.toFixed(8),signal:sig,histogram:macd===null||sig===null?null:+(macd-sig).toFixed(8)},atr14:atr(b),adx14:calcAdx(b),parabolicSar:calcPsar(b),bollinger20:mean===null?null:{middle:+mean.toFixed(8),upper:+(mean+2*sd!).toFixed(8),lower:+(mean-2*sd!).toFixed(8)},trend:e20!==null&&e50!==null?(last.close>e20&&e20>e50?"UPTREND":last.close<e20&&e20<e50?"DOWNTREND":"SIDEWAYS"):"UNCLEAR",barTime:last.openTime,barCount:b.length}}

async function fetchClosedBars(symbol:string,interval:string):Promise<Candle[]>{
 const url="https://biquote.io/api/"+encodeURIComponent(symbol)+"/ohlc?interval="+encodeURIComponent(interval)+"&limit=300";
 const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
 const raw=await response.text();
 if(!response.ok)throw Error("BiQuote OHLC HTTP "+response.status+": "+raw.slice(0,240));
 let payload:any;
 try{payload=JSON.parse(raw)}catch{throw Error("BiQuote mengirim JSON tidak valid: "+raw.slice(0,160))}
 const rows=Array.isArray(payload)?payload:Array.isArray(payload?.bars)?payload.bars:Array.isArray(payload?.data?.bars)?payload.data.bars:Array.isArray(payload?.data)?payload.data:null;
 if(!rows)throw Error("Format BiQuote tidak dikenali; keys="+Object.keys(payload||{}).join(",")+"; message="+String(payload?.message||payload?.error||"tanpa detail").slice(0,140));
 const bars:Candle[]=rows.map((x:any)=>({
  openTime:String(x.openTime??x.open_time??x.time??""),
  open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),
  volume:Number(x.volume??0),tickVolume:Number(x.tickVolume??x.tick_volume??0),
  isOpen:Boolean(x.isOpen??x.is_open??false)
 })).filter((x:Candle)=>Number.isFinite(Date.parse(x.openTime))&&[x.open,x.high,x.low,x.close].every(n=>Number.isFinite(n)&&n>0))
 .sort((x:Candle,y:Candle)=>Date.parse(x.openTime)-Date.parse(y.openTime));
 if(!bars.length)throw Error("BiQuote mengirim "+rows.length+" bar tetapi tidak ada candle valid; contoh="+JSON.stringify(rows[0]||{}).slice(0,220));
 return bars.filter(x=>!x.isOpen);
}
async function getMarketCandleContext(symbol:string,timeframe:string){
 symbol=symbol.split(/[—–-]/)[0].trim().toUpperCase().replace(/[^A-Z0-9._]/g,"");
 const aliases:Record<string,string>={GOLD:"XAUUSD",XAUUSD:"XAUUSD",BITCOIN:"BTCUSD",BTCUSD:"BTCUSD",US30:"US30"};
 symbol=aliases[symbol]||symbol;
 const map:Record<string,string>={M1:"1m",M5:"5m",M15:"15m",M30:"30m",H1:"1h",H4:"4h",D1:"1d","1m":"1m","5m":"5m","15m":"15m","30m":"30m","1h":"1h","4h":"4h","1d":"1d"};
 const interval=map[timeframe.toUpperCase()]||map[timeframe]||"15m";
 const higher:Record<string,string>={"1m":"15m","5m":"15m","15m":"1h","30m":"1h","1h":"4h","4h":"1d"};
 // Primary timeframe is mandatory; higher timeframe is optional and must never
 // make otherwise-valid primary OHLC data unavailable.
 const bars=await fetchClosedBars(symbol,interval);
 if(bars.length<50)throw Error("Candle tertutup tidak cukup untuk indikator (minimal 50)");
 const latest=bars[bars.length-1],age=Date.now()-Date.parse(latest.openTime);
 const dur:Record<string,number>={"1m":60000,"5m":300000,"15m":900000,"30m":1800000,"1h":3600000,"4h":14400000,"1d":86400000};
 if(!Number.isFinite(age)||age<0||age>dur[interval]*3)throw Error("Candle terakhir stale");
 let higherBars:Candle[]=[]; let higherError:string|null=null;
 if(higher[interval]){
  try{higherBars=await fetchClosedBars(symbol,higher[interval]);}
  catch(e){higherError=e instanceof Error?e.message:String(e);}
 }
 const higherLatest=higherBars[higherBars.length-1];
 const higherAge=higherLatest?Date.now()-Date.parse(higherLatest.openTime):Infinity;
 const higherFresh=!!higherLatest&&Number.isFinite(higherAge)&&higherAge>=0&&higherAge<=dur[higher[interval]]*3&&higherBars.length>=50;
 const mtf=higherFresh?{timeframe:higher[interval],barTime:higherLatest.openTime,trend:technical(higherBars).trend,indicators:technical(higherBars)}:{timeframe:higher[interval]||null,status:"UNAVAILABLE",reason:higherError||"Candle timeframe konfirmasi tidak cukup atau stale"};
 return {symbol,interval,source:"BiQuote OHLC",generatedAt:new Date().toISOString(),lastClosedBarAt:latest.openTime,closedBars:bars.length,indicators:technical(bars),multiTimeframe:mtf,bars};
}
async function persistMarketBars(admin:any,context:any){
 if(!context?.bars?.length)return {stored:0,error:"No candle data"};
 const rows=context.bars.map((b:Candle)=>({symbol:context.symbol,timeframe:context.interval,open_time:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:Number.isFinite(Number(b.volume))?b.volume:null,tick_volume:Number.isFinite(Number(b.tickVolume))?b.tickVolume:null,source:"BiQuote",fetched_at:new Date().toISOString()}));
 let stored=0;
 for(let i=0;i<rows.length;i+=200){
  const {error}=await admin.from("market_ohlc_bars").upsert(rows.slice(i,i+200),{onConflict:"symbol,timeframe,open_time",ignoreDuplicates:false});
  if(error)throw error;stored+=Math.min(200,rows.length-i);
 }
 return {stored};
}


Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"Method tidak didukung."},405);
 try{
  const auth=req.headers.get("Authorization")||""; if(!auth.startsWith("Bearer "))return reply({error:"Silakan login terlebih dahulu."},401);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,key=Deno.env.get("OPENAI_API_KEY");
  if(!url||!anon||!service)return reply({error:"Konfigurasi Supabase belum lengkap."},503);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:ud,error:ue}=await userClient.auth.getUser(); if(ue||!ud.user)return reply({error:"Sesi login tidak valid."},401);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const body=await req.json();
  if(body?.action==="history_list"){
   const {data,error,count}=await admin.from("analysis_history").select("id,asset,timeframe,result,created_at",{count:"exact"}).eq("user_id",ud.user.id).order("created_at",{ascending:false}).limit(200);
   if(error)throw error;
   return reply({status:"ok",items:data||[],total:Number(count||0)});
  }
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
  const quota=Number(planData.analysis_quota??(planCode==="free"?10:planCode==="starter"?20:0));
  if(body?.action==="quota_status")return reply({quota:{planCode:isAdmin?"owner":planCode,planName:isAdmin?"Akses Tanpa Batas":planName,total:isAdmin?null:quota,used:count,remaining:isAdmin?null:Math.max(0,quota-count),isUnlimited:isAdmin,periodLabel:"30 hari"}});
  if(!profile)return reply({error:"Profil akun belum tersedia. Hubungi Admin."},403);
  if(!isAdmin&&quota<=0)return reply({error:"Kuota paket belum dikonfigurasi. Hubungi Admin."},403);
  if(!isAdmin&&count>=quota)return reply({error:`Kuota paket ${planName} habis (${count}/${quota} analisis dalam 30 hari).`},403);
  if(!key)return reply({error:"Layanan AI belum dikonfigurasi di Supabase Secrets."},503);
  const image=String(body?.image||""),instrument=String(body?.instrument||"XAUUSD").slice(0,24),timeframe=String(body?.timeframe||"M15").slice(0,12),risk=Number(body?.risk);
  if(!/^data:image\/(png|jpeg|webp);base64,/.test(image)||image.length>9000000)return reply({error:"Gambar tidak valid atau terlalu besar."},400);
  if(!Number.isFinite(risk)||risk<=0||risk>0.5)return reply({error:"Risiko harus di atas 0% dan maksimal 0,5% per transaksi."},400);
  let marketContext:any=null,marketContextError:string|null=null;
  try{marketContext=await getMarketCandleContext(instrument,timeframe);try{marketContext.persistence=await persistMarketBars(admin,marketContext)}catch(storeError){marketContext.persistence={stored:0,error:storeError instanceof Error?storeError.message:String(storeError)}}}catch(e){marketContextError=e instanceof Error?e.message:String(e)}
  const marketContextInstruction=marketContext?`\n\nDATA OHLC SERVER (candle tertutup; indikator dihitung secara matematis): ${JSON.stringify({...marketContext,bars:undefined})}\nGunakan nilai ini sebagai sumber numerik indikator. Bandingkan arah timeframe entry dengan timeframe konfirmasi yang tersedia; jika tidak selaras, turunkan kesiapan entry ke WAIT. Screenshot tetap sumber visual support/resistance dan price action.`:`\n\nDATA OHLC TIDAK TERSEDIA: ${marketContextError}. Jangan mengarang indikator; fallback hanya analisis screenshot dan tandai keterbatasan.`;
  const prompt=`Anda adalah analis teknikal profesional untuk RitelAI Vision. Analisis bukti screenshot dan data OHLC server jika tersedia. Instrumen ${instrument}; timeframe ${timeframe}; risiko maksimum ${risk}% per transaksi (batas sistem 0,5%). Jika minimum lot broker membuat risiko melebihi batas, rekomendasikan WAIT dan jangan menaikkan lot. Jawab JSON valid saja dalam Bahasa Indonesia.${marketContextInstruction}

PROSEDUR WAJIB:
1. Baca struktur swing: tandai minimal dua swing high dan dua swing low yang terlihat bila memungkinkan. Klasifikasikan HH/HL, LH/LL, atau range. Jangan simpulkan trend hanya dari satu candle. Jika swing tidak cukup jelas, trend=UNCLEAR dan confidence rendah.
2. Petakan SUPPORT/RESISTANCE dari zona reaksi harga yang berulang (minimal dua reaksi terpisah jika memungkinkan), bukan hanya harga candle terakhir atau satu wick. Kembalikan zona sebagai {low, high, evidence, touches}; low/high hanya angka yang terbaca dari skala chart. Pisahkan support utama, support berikutnya, resistance terdekat, resistance berikutnya. Bila tidak terbaca, null. Jangan menyebut harga terakhir sebagai support tanpa bukti reaksi.
3. Bedakan kondisi:
   - BREAKOUT hanya setelah candle close melewati zona; wick saja bukan breakout.
   - RETEST setelah breakout dan harga kembali menguji zona dari sisi seberang.
   - REJECTION bila harga menyentuh zona lalu candle close menjauh dengan bukti candle yang tampak.
   - PULLBACK adalah koreksi melawan trend utama, bukan otomatis reversal.
   - REVERSAL memerlukan perubahan struktur (misalnya break swing dan terbentuk HH/HL atau LH/LL baru) plus konfirmasi.
4. Pisahkan ARAH PASAR dari KESIAPAN ENTRY. Untuk trend yang terbaca jelas UPTREND, arah utama wajib BUY; untuk DOWNTREND, arah utama wajib SELL, meskipun entry_readiness masih WAIT_CONFIRMATION. Untuk SIDEWAYS, signal boleh WAIT dan jelaskan batas atas/bawah range serta rencana buy dekat support dan sell dekat resistance. WAIT sebagai signal utama hanya untuk SIDEWAYS yang belum punya breakout, atau UNCLEAR karena bukti chart memang tidak memadai/konflik. Jangan mengeluarkan WAIT hanya karena entry belum terkonfirmasi atau indikator tidak tampak. Jika ada trend tetapi harga sudah terlalu jauh/overextended, tetap tampilkan arah BUY/SELL dengan entry_readiness=WAIT_CONFIRMATION dan tunggu pullback/retest; jangan menyuruh mengejar harga. Tambahkan decision_type (DIRECTIONAL_BIAS atau ENTRY_READY), directional_bias (BUY/SELL/NEUTRAL), buy_score_pct, sell_score_pct, wait_score_pct (jumlah tepat 100; ini bobot skenario, bukan probabilitas profit), dan entry_readiness (READY/WAIT_CONFIRMATION/NOT_READY). BUY/SELL sebagai arah tidak berarti entry market seketika.
5. Skenario BUY dan SELL harus dinilai independen dan tetap dijelaskan meskipun bukan arah utama. Jangan jadikan kegagalan menghitung entry sebagai alasan mengubah trend yang jelas menjadi WAIT. SL wajib di luar struktur invalidasi, TP mengacu swing/zona berikutnya. Hitung risk_reward secara matematis dari jarak entry ke SL dibanding entry ke TP1; jangan menebak atau mengarang RR. Jika RR kurang dari 1.5, tandai setup NOT_VALID/WAIT_CONFIRMATION dan jelaskan, tetapi arah trend tetap BUY/SELL. Jangan keluarkan angka entry/SL/TP yang tidak terbaca atau tidak konsisten.
6. Risiko dan ukuran posisi: jangan hitung lot jika contract size, nilai tick, dan mata uang akun tidak tersedia. Tampilkan risiko maksimum pengguna ${risk}% saja; bukan rekomendasi ukuran lot.
7. Confidence adalah tingkat kejelasan bukti visual (0-100), bukan probabilitas profit/win rate. buy_score_pct + sell_score_pct + wait_score_pct wajib 100. Skor menggambarkan bobot arah relatif dari bukti visual, bukan peluang menang. Untuk UPTREND, buy_score_pct harus paling tinggi; untuk DOWNTREND, sell_score_pct harus paling tinggi; untuk SIDEWAYS, wait_score_pct boleh paling tinggi. Sebutkan bukti yang mendukung dan menentang skenario utama.
8. Harga dari screenshot adalah DATA SNAPSHOT, bukan harga live. Jangan klaim real-time, streaming, sinkron broker, atau menyatakan harga masih berlaku. Kembalikan chart_price_status="snapshot_only", chart_timestamp hanya jika terbaca; bila tidak terbaca null. Minta pengguna verifikasi harga terkini di broker sebelum entry.
9. DETEKSI INDIKATOR OTOMATIS DARI SCREENSHOT (WAJIB): customer tidak perlu memilih indikator secara manual. Periksa seluruh gambar yang diunggah, termasuk panel bawah chart, legenda, label, skala, garis, histogram, dan angka di sisi kanan. Deteksi indikator yang benar-benar tampak pada gambar. Untuk setiap indikator, gunakan status AVAILABLE hanya jika identitas indikator dan informasi yang diperlukan cukup jelas terbaca; jika indikator tidak terpasang/tidak tampak, gunakan UNAVAILABLE dengan reason "Panel/indikator tidak terlihat pada screenshot"; jika terlihat tetapi buram/terpotong/tidak dapat dibaca, gunakan UNAVAILABLE dengan reason yang menyebut bagian yang tidak terbaca. Jangan menebak nilai dari bentuk chart, jangan menghitung RSI/MACD/ATR dari screenshot chart polos, dan jangan menganggap warna/garis tanpa label sebagai indikator tertentu. Periksa EMA 9/20/50/200 (posisi harga, kemiringan, susunan/ribbon dan cross), Parabolic SAR (titik di atas/bawah candle dan perubahan sisi), RSI 14 (zona 30/50/70 dan divergence hanya bila swing terlihat), MACD (line/signal cross dan histogram), ADX/DMI (kekuatan trend dan +DI/-DI), Bollinger Bands (squeeze, expansion, posisi band), VWAP (posisi harga terhadap VWAP dan reclaim/rejection bila garis terlihat), Stochastic RSI (cross %K/%D dan zona ekstrem bila panel terbaca), ATR (volatilitas untuk jarak SL, bukan arah), serta volume (bar, skala dan perbandingan dengan bar sebelumnya hanya jika terlihat). Untuk RSI, MACD, volume, dan ATR, keluarkan field ringkas masing-masing dengan struktur {status,signal,reading,reason}; jika UNAVAILABLE, reading=null dan signal="WAIT". indicator_signals WAJIB berupa array yang memuat satu objek untuk SETIAP indikator di daftar tersebut, termasuk yang UNAVAILABLE, dengan bentuk {name,status,signal,reading,reason}. Jangan hilangkan indikator yang tidak ditemukan. Setiap AVAILABLE harus menyertakan bukti visual spesifik dan nilai hanya jika benar-benar terbaca. Berikan juga indicator_consensus {buy_count,sell_count,wait_count,available_count,overall,reason}; hitung hanya indikator arah yang AVAILABLE, ATR bukan indikator arah dan tidak dihitung sebagai BUY/SELL. Jangan anggap semua indikator independen. Jika indikator tidak tersedia, jangan jadikan itu alasan tunggal untuk membatalkan pembacaan price action.
10. Jika chart blur, skala tidak terbaca, atau timeframe/simbol tidak jelas, turunkan confidence dan jelaskan keterbatasannya. Pilih WAIT hanya bila arah memang tidak dapat dibedakan dari bukti yang terlihat; indikator yang tidak tampil saja tidak otomatis membatalkan pembacaan price action.

PENDING ORDER WAJIB:
Evaluasi buy_limit dan sell_limit secara independen. BUY_LIMIT hanya pada zona support/demand yang benar-benar terlihat; SELL_LIMIT hanya pada resistance/supply yang terlihat. Setiap rencana berisi status VALID_SETUP/WAIT_CONFIRMATION/NOT_VALID, entry_price, entry_zone_low/high, stop_loss, take_profit_1/2, risk_reward, zone_type, rationale, evidence, invalidation, confidence_score 0-100. Confidence_score adalah skor kualitas bukti setup, BUKAN probabilitas profit atau akurasi. historical_accuracy_pct wajib null sampai hasil backtest/forward test terverifikasi. Jangan memaksakan limit: jika level tidak terbaca, RR tidak masuk akal, atau bukti kurang, semua harga null dan status WAIT_CONFIRMATION/NOT_VALID. Jelaskan no_trade_reason. Jangan entry limit tanpa menjelaskan risiko harga menyentuh zona lalu menembusnya.
CHART ANNOTATIONS WAJIB:
Kembalikan field chart_annotations dengan struktur {status:"AVAILABLE"|"PARTIAL"|"UNAVAILABLE",plot_area:{x_pct,y_pct,width_pct,height_pct},zones:[{type,label,price_low,price_high,y_top_pct,y_bottom_pct,evidence}],levels:[{type,label,price,y_pct,evidence}],notes:[string]}.
Tujuan: membuat overlay visual di atas screenshot asli. Koordinat x_pct/y_pct/width_pct/height_pct dan y_top_pct/y_bottom_pct memakai skala 0-100 relatif terhadap seluruh gambar yang diunggah; koordinat y=0 adalah tepi atas gambar. Estimasikan hanya bila area plot chart dan skala harga terlihat cukup jelas. Untuk zona, y_top_pct harus lebih kecil daripada y_bottom_pct. Gunakan tipe BUY_ZONE, SELL_ZONE, SUPPORT, RESISTANCE, DEMAND, SUPPLY, FVG, RETEST. Untuk garis level gunakan BREAKOUT_UP, BREAKOUT_DOWN, ENTRY, STOP_LOSS, TAKE_PROFIT. Sertakan label harga hanya bila terbaca dari skala. Area resistance/supply dan SELL_ZONE harus dibedakan; demand/support dan BUY_ZONE juga. FVG hanya jika gap/imbalance tiga-candle benar-benar tampak; retest hanya jika breakout lalu pengujian ulang terlihat. Sertakan bukti spesifik. Jika posisi zona pada gambar tidak dapat dipetakan dengan yakin, jangan mengarang koordinat: kembalikan status UNAVAILABLE atau hilangkan zona itu dan jelaskan notes. Plot area harus menghindari header, toolbar, panel indikator, dan skala harga. Jangan menutupi candlestick dengan label besar. 
FIELD JSON WAJIB:
signal (BUY/SELL/WAIT), decision_type (DIRECTIONAL_BIAS/ENTRY_READY), directional_bias (BUY/SELL/NEUTRAL), buy_score_pct, sell_score_pct, wait_score_pct (jumlah tepat 100; skor skenario bukan probabilitas profit), entry_readiness (READY/WAIT_CONFIRMATION/NOT_READY), summary (2-4 kalimat, sebut struktur dan kondisi), trend (UPTREND/DOWNTREND/SIDEWAYS/UNCLEAR), market_structure, swing_points (array objek {type, price, evidence}; maksimal 8), support_resistance (objek {support_primary, support_secondary, resistance_nearest, resistance_secondary, method}), setup_type (BREAKOUT/RETEST/REJECTION/PULLBACK/REVERSAL/NONE), entry, entry_zone, entry_trigger, stop_loss, take_profit_1, take_profit_2, risk_reward, invalidation, confidence, supporting_evidence (array), opposing_evidence (array), confirmation (array), warnings (array), scenario_buy dan scenario_sell (masing-masing objek {trigger, confirmation, entry_condition, invalidation, rationale, entry_price, entry_zone_low, entry_zone_high, stop_loss, take_profit_1, take_profit_2, risk_reward}). Isi harga entry, SL dan TP hanya bila level dapat dibaca/dihitung wajar dari struktur chart; selain itu null. entry_price adalah level entry rencana berdasarkan snapshot chart, BUKAN harga market live. Skenario BUY memakai pemicu breakout/retest; SELL memakai rejection/breakdown. Harga entry SELL wajib ditampilkan sama seperti BUY bila terbaca; jangan menyalin harga BUY ke SELL., pending_orders (objek {buy_limit, sell_limit, no_trade_reason}), chart_annotations (objek sesuai skema CHART ANNOTATIONS WAJIB), chart_price_status, chart_timestamp, indicator_signals (array {name,status,signal,reading,reason}), indicator_consensus ({buy_count,sell_count,wait_count,available_count,overall,reason}), rsi, macd, volume, volatility, reasoning, disclaimer.
Semua angka harga harus bersumber dari screenshot. Untuk level yang tidak terbaca gunakan null. chart_price_status harus snapshot_only. Jangan berikan janji profit.`;;

   const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",input:[{role:"user",content:[{type:"input_text",text:prompt},{type:"input_image",image_url:image,detail:"high"}]}],text:{format:{type:"json_object"}},max_output_tokens:3000})});
  const raw=await res.json();if(!res.ok){const apiMessage=raw?.error?.message||`OpenAI HTTP ${res.status}`;throw new Error(`OpenAI HTTP ${res.status}: ${apiMessage}`);}
  if(raw.status==="incomplete")throw new Error(`OpenAI incomplete response: ${raw.incomplete_details?.reason||"output limit"}`);
  const txt=String(raw.output_text||(raw.output||[]).flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text).join("\n")).replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
  if(!txt)throw new Error("OpenAI returned an empty analysis response.");
  let result:any;try{result=JSON.parse(txt);}catch(_){throw new Error("OpenAI response was not valid JSON.");}
  if(!result||typeof result!=="object")throw new Error("OpenAI returned an invalid analysis object.");
  result.market_data=marketContext?{status:"AVAILABLE",source:marketContext.source,symbol:marketContext.symbol,interval:marketContext.interval,closed_bars:marketContext.closedBars,last_closed_bar_at:marketContext.lastClosedBarAt,indicators:marketContext.indicators,multi_timeframe:marketContext.multiTimeframe,persisted_bars:marketContext.persistence?.stored??0}:{status:"UNAVAILABLE",reason:marketContextError||"OHLC tidak tersedia"};
  if(marketContext){const i=marketContext.indicators,m=i.macd,e=i.ema,computed=[{name:"EMA 9/20/50/200",status:"AVAILABLE",signal:i.trend==="UPTREND"?"BUY":i.trend==="DOWNTREND"?"SELL":"WAIT",reading:e,reason:"Dihitung dari candle OHLC tertutup; bias "+i.trend},{name:"RSI 14",status:"AVAILABLE",signal:i.rsi14===null?"WAIT":i.rsi14>=55?"BUY":i.rsi14<=45?"SELL":"WAIT",reading:i.rsi14,reason:"RSI Wilder dihitung server"},{name:"MACD 12/26/9",status:"AVAILABLE",signal:m.histogram>0?"BUY":m.histogram<0?"SELL":"WAIT",reading:m,reason:"MACD dihitung server dari close candle"},{name:"ATR 14",status:"AVAILABLE",signal:"WAIT",reading:i.atr14,reason:"Volatilitas, bukan indikator arah"},{name:"Bollinger Bands 20",status:"AVAILABLE",signal:"WAIT",reading:i.bollinger20,reason:"SMA20 dan deviasi standar 2σ"}];const old=Array.isArray(result.indicator_signals)?result.indicator_signals:[];const n=new Set(computed.map(x=>x.name));result.indicator_signals=[...computed,...old.filter((x:any)=>!n.has(String(x.name)))];result.indicator_consensus={...(result.indicator_consensus||{}),available_count:computed.length,overall:i.trend,reason:"Indikator numerik dihitung dari OHLC server."};computed.push({name:"ADX 14",status:i.adx14===null?"UNAVAILABLE":"AVAILABLE",signal:"WAIT",reading:i.adx14,reason:"Mengukur kekuatan tren, bukan arah"});computed.push({name:"Parabolic SAR",status:i.parabolicSar?"AVAILABLE":"UNAVAILABLE",signal:i.parabolicSar?.bias||"WAIT",reading:i.parabolicSar,reason:"Bias dihitung dari high/low candle OHLC"});result.indicator_signals=computed.concat(old.filter((x:any)=>!new Set(computed.map(y=>y.name)).has(String(x.name))));}
  if(marketContext){
   const i=marketContext.indicators,mtf=marketContext.multiTimeframe;
   const aiTrend=String(result.trend||"UNCLEAR").toUpperCase(),marketTrend=String(i.trend||"UNCLEAR").toUpperCase();
   const direction=aiTrend==="UPTREND"||marketTrend==="UPTREND"?"BUY":aiTrend==="DOWNTREND"||marketTrend==="DOWNTREND"?"SELL":"WAIT";
   const mtfTrend=String(mtf?.trend||"UNCLEAR").toUpperCase();
   const mtfAligned=direction==="BUY"?mtfTrend==="UPTREND":direction==="SELL"?mtfTrend==="DOWNTREND":false;
   const mtfConflict=direction==="BUY"?mtfTrend==="DOWNTREND":direction==="SELL"?mtfTrend==="UPTREND":false;
   const momentum=(direction==="BUY"?(i.rsi14!==null&&i.rsi14>=50&&Number(i.macd?.histogram)>0):(direction==="SELL"?(i.rsi14!==null&&i.rsi14<=50&&Number(i.macd?.histogram)<0):false));
   const structureScore=(aiTrend===marketTrend&&direction!=="WAIT")?30:direction!=="WAIT"?18:8;
   const momentumScore=momentum?25:12;
   const entryReady=/READY|VALID_SETUP|CONFIRMED/i.test(String(result.entry_readiness||""))?20:10;
   const mtfScore=mtfAligned?15:mtfConflict?0:7;
   const volatilityScore=Number(i.atr14)>0&&i.bollinger20?10:4;
   const quality=Math.min(100,structureScore+momentumScore+entryReady+mtfScore+volatilityScore);
   result.setup_quality_score=quality;
   result.setup_quality_label=quality>=85?"SANGAT KUAT":quality>=75?"KUAT":quality>=60?"MENUNGGU KONFIRMASI":"LEMAH / WAIT";
   result.setup_quality_breakdown={trend_structure:{score:structureScore,max:30},momentum:{score:momentumScore,max:25},entry_zone:{score:entryReady,max:20},multi_timeframe:{score:mtfScore,max:15,trend:mtfTrend},volatility:{score:volatilityScore,max:10}};
   result.setup_quality_disclaimer="Skor kualitas setup berdasarkan bukti teknikal, bukan probabilitas profit atau win rate; belum dioptimalkan melalui backtest.";
   if(mtfConflict){result.entry_readiness="WAIT_CONFIRMATION";result.mtf_warning="Arah timeframe konfirmasi berlawanan dengan arah timeframe analisis. Tunggu keselarasan sebelum entry.";}
  }
  if(!["BUY","SELL","WAIT"].includes(String(result.signal).toUpperCase()))result.signal="WAIT";
  if(!["UPTREND","DOWNTREND","SIDEWAYS","UNCLEAR"].includes(String(result.trend||"").toUpperCase()))result.trend="UNCLEAR";
  const arr=(v:any)=>Array.isArray(v)?v.map((x:any)=>String(x)).slice(0,8):[];
  const makeOrder=(v:any,side:"BUY_LIMIT"|"SELL_LIMIT")=>{const x=v&&typeof v==="object"?v:{};const num=(k:string)=>x[k]!==null&&x[k]!==undefined&&x[k]!==""&&Number.isFinite(Number(x[k]))?Number(x[k]):null;const entry=num("entry_price"),sl=num("stop_loss"),tp1=num("take_profit_1"),tp2=num("take_profit_2");let status=["VALID_SETUP","WAIT_CONFIRMATION","NOT_VALID"].includes(String(x.status||"").toUpperCase())?String(x.status).toUpperCase():"WAIT_CONFIRMATION";let rr:number|null=null;const risk=entry!==null&&sl!==null?Math.abs(entry-sl):0;const reward=entry!==null&&tp1!==null?(side==="BUY_LIMIT"?tp1-entry:entry-tp1):0;if(entry!==null&&sl!==null&&tp1!==null){const valid=side==="BUY_LIMIT"?(sl<entry&&tp1>entry):(sl>entry&&tp1<entry);if(!valid||risk<=0||reward<=0)status="NOT_VALID";else{rr=Number((reward/risk).toFixed(2));if(rr<1.5&&status==="VALID_SETUP")status="WAIT_CONFIRMATION";}}else if(status==="VALID_SETUP")status="WAIT_CONFIRMATION";const z=["SUPPORT","DEMAND","RESISTANCE","SUPPLY","RETEST","UNAVAILABLE"].includes(String(x.zone_type||"").toUpperCase())?String(x.zone_type).toUpperCase():"UNAVAILABLE";const sc=Number(x.confidence_score);if(status==="VALID_SETUP"&&(!Number.isFinite(sc)||sc<75))status="WAIT_CONFIRMATION";return {order_type:side,status,entry_price:entry,entry_zone_low:num("entry_zone_low"),entry_zone_high:num("entry_zone_high"),stop_loss:sl,take_profit_1:tp1,take_profit_2:tp2,risk_reward:rr,zone_type:z,rationale:String(x.rationale||"Bukti zona belum cukup.")+(rr!==null&&rr<1.5?" RR hasil hitung server di bawah 1.5; jangan entry.":""),evidence:arr(x.evidence),invalidation:String(x.invalidation||"Batalkan jika struktur zona ditembus candle konfirmasi."),confidence_score:Number.isFinite(sc)?Math.max(0,Math.min(100,Math.round(sc))):0,historical_accuracy_pct:null};};
  const orders=result.pending_orders&&typeof result.pending_orders==="object"?result.pending_orders:{};
  const pendingOrders={buy_limit:makeOrder(orders.buy_limit,"BUY_LIMIT"),sell_limit:makeOrder(orders.sell_limit,"SELL_LIMIT"),no_trade_reason:String(orders.no_trade_reason||"Tidak ada order jika bukti zona dan level belum memadai.")};
  const {data:quotaResult,error:quotaError}=await admin.rpc("consume_analysis_quota",{p_user_id:ud.user.id,p_asset:instrument,p_timeframe:timeframe,p_result:result});
  if(quotaError)throw new Error("Pencatatan kuota gagal. Terapkan migration 20261117_analysis_quota_atomic.sql terlebih dahulu. "+quotaError.message);
  const quotaRow=Array.isArray(quotaResult)?quotaResult[0]:quotaResult;
  if(!quotaRow?.allowed)return reply({error:"Kuota analisis habis. Paket Free 5/5 dan Starter 20/20 dihitung dalam 30 hari. Upgrade paket untuk melanjutkan.",code:"QUOTA_EXHAUSTED",quota:quotaRow},403);const trend=String(result.trend||"UNCLEAR").toUpperCase();const bias=trend==="UPTREND"?"BUY":trend==="DOWNTREND"?"SELL":"NEUTRAL";if(bias!=="NEUTRAL"){result.signal=bias;result.directional_bias=bias;result.decision_type="DIRECTIONAL_BIAS";result.entry_readiness=String(result.entry_readiness||"WAIT_CONFIRMATION").toUpperCase();let buy=Number(result.buy_score_pct),sell=Number(result.sell_score_pct),wait=Number(result.wait_score_pct);if(![buy,sell,wait].every(Number.isFinite)||buy<0||sell<0||wait<0||Math.abs(buy+sell+wait-100)>1||(bias==="BUY"&&buy<=sell)||(bias==="SELL"&&sell<=buy)){buy=bias==="BUY"?65:20;sell=bias==="SELL"?65:20;wait=15;}const total=buy+sell+wait;result.buy_score_pct=Math.round(buy/total*100);result.sell_score_pct=Math.round(sell/total*100);result.wait_score_pct=100-result.buy_score_pct-result.sell_score_pct;}else{result.directional_bias=String(result.directional_bias||"NEUTRAL");const buy=Number(result.buy_score_pct),sell=Number(result.sell_score_pct),wait=Number(result.wait_score_pct);if(![buy,sell,wait].every(Number.isFinite)||Math.abs(buy+sell+wait-100)>1){result.buy_score_pct=30;result.sell_score_pct=30;result.wait_score_pct=40;}}const conf=Number(result.confidence); const sr=result.support_resistance&&typeof result.support_resistance==="object"?result.support_resistance:{}; const scenarioBuy=scenarioOrFallback(result.scenario_buy,"BUY",sr); const scenarioSell=scenarioOrFallback(result.scenario_sell,"SELL",sr); return reply({result:{signal:String(result.signal).toUpperCase(),summary:String(result.summary||"Analisis selesai."),entry:result.entry??null,stop_loss:result.stop_loss??null,scenario_buy:scenarioBuy,scenario_sell:scenarioSell,pending_orders:pendingOrders,take_profit_1:result.take_profit_1??result.take_profit??null,take_profit:result.take_profit_1??result.take_profit??null,take_profit_2:result.take_profit_2??null,risk_reward:result.risk_reward??null,confidence:Number.isFinite(conf)?Math.max(0,Math.min(100,conf)):0,decision_type:result.decision_type??"DIRECTIONAL_BIAS",directional_bias:result.directional_bias??(String(result.signal).toUpperCase()==="BUY"?"BUY":String(result.signal).toUpperCase()==="SELL"?"SELL":"NEUTRAL"),buy_score_pct:result.buy_score_pct??null,sell_score_pct:result.sell_score_pct??null,wait_score_pct:result.wait_score_pct??null,entry_readiness:result.entry_readiness??"WAIT_CONFIRMATION",trend:result.trend??"UNCLEAR",support_resistance:formatDisplay(result.support_resistance),support_resistance_detail:result.support_resistance??null,market_structure:result.market_structure??null,swing_points:Array.isArray(result.swing_points)?result.swing_points.slice(0,8):[],setup_type:result.setup_type??"NONE",entry_zone:result.entry_zone??null,entry_trigger:result.entry_trigger??null,invalidation:result.invalidation??null,supporting_evidence:arr(result.supporting_evidence),opposing_evidence:arr(result.opposing_evidence),chart_price_status:"snapshot_only",chart_timestamp:result.chart_timestamp??null,indicator_signals:Array.isArray(result.indicator_signals)?result.indicator_signals.slice(0,12):[],indicator_consensus:result.indicator_consensus&&typeof result.indicator_consensus==="object"?result.indicator_consensus:null,market_data:result.market_data??{status:"UNAVAILABLE",reason:"Server tidak menyertakan payload market_data."},setup_quality_score:result.setup_quality_score??null,setup_quality_label:result.setup_quality_label??null,setup_quality_disclaimer:result.setup_quality_disclaimer??null,setup_quality_breakdown:result.setup_quality_breakdown??null,mtf_warning:result.mtf_warning??null,rsi:formatDisplay(result.rsi),rsi_detail:result.rsi??null,macd:formatDisplay(result.macd),macd_detail:result.macd??null,volume:formatDisplay(result.volume),volume_detail:result.volume??null,volatility:formatDisplay(result.volatility),volatility_detail:result.volatility??null,reasoning:result.reasoning??result.summary??null,confirmation:arr(result.confirmation),warnings:arr(result.warnings),disclaimer:result.disclaimer??"Analisis hanya berdasarkan screenshot (snapshot), bukan harga live. Verifikasi harga dan level di broker sebelum entry. Bukan jaminan profit."}});
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