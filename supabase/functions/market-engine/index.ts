import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const reply=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:CORS});
type Bar={openTime:string;open:number;high:number;low:number;close:number;volume?:number;tickVolume?:number;isOpen?:boolean};
function ema(v:number[],p:number){if(v.length<p)return null;const k=2/(p+1);let x=v.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<v.length;i++)x=v[i]*k+x*(1-k);return x}
function metrics(bars:Bar[]){
 const closes=bars.map(x=>x.close),fast=closes.map((_,i)=>ema(closes.slice(0,i+1),20)),slow=closes.map((_,i)=>ema(closes.slice(0,i+1),50));
 const trades:{side:string;entryTime:string;exitTime:string;entry:number;exit:number;returnPct:number}[]=[];
 let position:{side:"LONG"|"SHORT";entry:number;entryTime:string}|null=null;
 for(let i=51;i<bars.length-1;i++){
  const prev=(fast[i-1]??0)-(slow[i-1]??0),now=(fast[i]??0)-(slow[i]??0);
  const cross=prev<=0&&now>0?"LONG":prev>=0&&now<0?"SHORT":null;
  const fill=bars[i+1].open;
  if(position&&cross&&cross!==position.side){
   const ret=(position.side==="LONG"?(fill-position.entry)/position.entry:(position.entry-fill)/position.entry)*100;
   trades.push({side:position.side,entryTime:position.entryTime,exitTime:bars[i+1].openTime,entry:position.entry,exit:fill,returnPct:+ret.toFixed(4)});
   position=null;
  }
  if(!position&&cross)position={side:cross,entry:fill,entryTime:bars[i+1].openTime};
 }
 if(position){const last=bars[bars.length-1],ret=(position.side==="LONG"?(last.close-position.entry)/position.entry:(position.entry-last.close)/position.entry)*100;trades.push({side:position.side,entryTime:position.entryTime,exitTime:last.openTime,entry:position.entry,exit:last.close,returnPct:+ret.toFixed(4)});}
 const wins=trades.filter(t=>t.returnPct>0),losses=trades.filter(t=>t.returnPct<=0),grossWin=wins.reduce((a,t)=>a+t.returnPct,0),grossLoss=Math.abs(losses.reduce((a,t)=>a+t.returnPct,0));
 let equity=100,peak=100,maxDd=0;for(const t of trades){equity*=1+t.returnPct/100;peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak*100);}
 return {strategy:"EMA20/EMA50 crossover; entry at next candle open; exit on reverse crossover",trade_count:trades.length,wins:wins.length,losses:losses.length,win_rate_pct:trades.length?+(wins.length/trades.length*100).toFixed(2):null,profit_factor:grossLoss?+(grossWin/grossLoss).toFixed(3):grossWin?null:0,net_return_pct:+(equity-100).toFixed(2),max_drawdown_pct:+maxDd.toFixed(2),sample_start:bars[0].openTime,sample_end:bars[bars.length-1].openTime,candle_count:bars.length,cost_model:"NOT_INCLUDED",warning:"Hasil gross sebelum spread, komisi, swap, slippage, dan latency. Bukan jaminan performa live.",recent_trades:trades.slice(-20)};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return reply({error:"POST required"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth=req.headers.get("Authorization")||"";if(!auth.startsWith("Bearer "))return reply({error:"Login required"},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:ud,error:ue}=await userClient.auth.getUser();if(ue||!ud.user)return reply({error:"Invalid session"},401);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const body=await req.json(),symbol=String(body.symbol||"XAUUSD").split(/[—–-]/)[0].trim().toUpperCase();
  if(!["XAUUSD","BTCUSD","EURUSD","GBPUSD","USDJPY","US30","ETHUSD","SOLUSD"].includes(symbol))return reply({error:"Unsupported symbol"},400);
  if(body.action==="backfill_daily"){
   const to=new Date(),from=new Date(to.getTime()-365*86400000),u=new URL("https://biquote.io/api/"+encodeURIComponent(symbol)+"/ohlc");
   u.searchParams.set("interval","1d");u.searchParams.set("from",from.toISOString());u.searchParams.set("to",to.toISOString());u.searchParams.set("limit","1000");
   const res=await fetch(u,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error("OHLC provider HTTP "+res.status);
   const data=await res.json();if(!Array.isArray(data?.bars))throw Error("Invalid OHLC payload");
   const bars=(data.bars as Bar[]).filter(b=>!b.isOpen&&Number.isFinite(Date.parse(b.openTime))&&[b.open,b.high,b.low,b.close].every(x=>Number.isFinite(Number(x))&&Number(x)>0)).sort((a,b)=>Date.parse(a.openTime)-Date.parse(b.openTime));
   if(bars.length<100)return reply({error:"Historical data below minimum 100 daily candles",received:bars.length},422);
   const rows=bars.map(b=>({symbol,timeframe:"1d",open_time:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??null,tick_volume:b.tickVolume??null,source:"BiQuote",fetched_at:new Date().toISOString()}));
   for(let i=0;i<rows.length;i+=200){const {error}=await admin.from("market_ohlc_bars").upsert(rows.slice(i,i+200),{onConflict:"symbol,timeframe,open_time"});if(error)throw error;}
   return reply({status:"ok",symbol,timeframe:"1d",stored:bars.length,from:bars[0].openTime,to:bars[bars.length-1].openTime,source:"BiQuote",note:"Backfill harian; intraday tidak diasumsikan memiliki arsip 12 bulan."});
  }
  if(body.action==="run_backtest"){
   const {data:bars,error}=await admin.from("market_ohlc_bars").select("open_time,open,high,low,close").eq("symbol",symbol).eq("timeframe","1d").order("open_time",{ascending:true}).limit(1000);
   if(error)throw error;if(!bars||bars.length<100)return reply({error:"Historical data belum cukup. Jalankan backfill harian terlebih dahulu.",candle_count:bars?.length||0},422);
   const normalized=bars.map((b:any)=>({...b,openTime:b.open_time}));
   const result=metrics(normalized);
   const {data:saved,error:saveError}=await admin.from("backtest_runs").insert({user_id:ud.user.id,symbol,timeframe:"1d",strategy:result.strategy,parameters:{fast_ema:20,slow_ema:50,fill:"next_open"},metrics:result,sample_start:result.sample_start,sample_end:result.sample_end,candle_count:result.candle_count}).select("id").single();
   if(saveError)throw saveError;
   return reply({status:"ok",id:saved.id,...result});
  }
  if(body.action==="history"){
   const {data,error}=await admin.from("backtest_runs").select("id,symbol,timeframe,strategy,metrics,sample_start,sample_end,candle_count,created_at").eq("user_id",ud.user.id).order("created_at",{ascending:false}).limit(20);
   if(error)throw error;return reply({status:"ok",items:data||[]});
  }
  return reply({error:"Unknown action"},400);
 }catch(e){return reply({error:e instanceof Error?e.message:String(e)},500)}
});
