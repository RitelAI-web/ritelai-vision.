// RitelAI MT5 Bridge — pairing, heartbeat, signal polling and receipts.
// Apply supabase/migrations/202611160001_mt5_bridge.sql before deploying.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
type Obj = Record<string, any>;
const reply = (body: Obj, status=200) => new Response(JSON.stringify(body), {status, headers:cors});
const hex = (bytes: Uint8Array) => [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
const randomToken = (n=32) => { const b=new Uint8Array(n); crypto.getRandomValues(b); return hex(b); };
async function sha(value:string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
const clean = (v:any,n=100) => String(v??"").trim().slice(0,n);
// Broker names are normalized identifiers, not a hard-coded broker allowlist.
const validBroker = (v:string) => /^[A-Z0-9_ -]{2,24}$/.test(v);
const validProfile = (_b:string,p:string) => ["CENT","STANDARD_CENT","STANDARD","ZERO","RAW","PRO","ECN","ISLAMIC","OTHER"].includes(p);

async function hasActiveEnterprise(admin:any,userId:string){
  const now=new Date().toISOString();
  const {data:subs,error:subErr}=await admin.from("subscriptions")
    .select("plan_id,status,starts_at,ends_at")
    .eq("user_id",userId)
    .eq("status","active")
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .limit(20);
  if(subErr) return {allowed:false,error:subErr.message,subscriptionCount:0,planCodes:[] as string[]};
  const ids=[...new Set((subs||[]).map((s:any)=>s.plan_id).filter(Boolean))];
  if(!ids.length) return {allowed:false,error:null,subscriptionCount:(subs||[]).length,planCodes:[] as string[]};
  const {data:plans,error:planErr}=await admin.from("plans").select("id,code,name").in("id",ids);
  if(planErr) return {allowed:false,error:planErr.message,subscriptionCount:subs.length,planCodes:[] as string[]};
  const planCodes=(plans||[]).map((p:any)=>String(p.code||p.name||"").trim());
  const allowed=(plans||[]).some((p:any)=>{
    const code=String(p.code||"").toLowerCase().replace(/[^a-z]/g,"");
    const name=String(p.name||"").toLowerCase().replace(/[^a-z]/g,"");
    return code==="elite" || code.includes("enterprise") || name.includes("enterprise") || name==="elite";
  });
  return {allowed,error:null,subscriptionCount:subs.length,planCodes};
}

async function getAccountAccess(admin:any,userId:string){
  const {data:profile,error:profileErr}=await admin.from("profiles")
    .select("role").eq("id",userId).maybeSingle();
  if(profileErr) return {allowed:false,error:profileErr.message,role:"customer",subscriptionCount:0,planCodes:[] as string[]};
  const role=String(profile?.role||"customer").trim().toLowerCase();
  if(["owner","admin","super_admin"].includes(role)){
    return {allowed:true,error:null,role,subscriptionCount:0,planCodes:[role.toUpperCase()]};
  }
  const entitlement=await hasActiveEnterprise(admin,userId);
  return {...entitlement,role};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return reply({error:"Gunakan POST."},405);
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return reply({error:"Supabase bridge belum dikonfigurasi."},503);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  let body:Obj={}; try{body=await req.json();}catch{return reply({error:"JSON tidak valid."},400);}
  const action=clean(body.action,40);

  // Website-only actions require a valid Supabase user JWT.
  if(action==="check_access" || action==="create_pairing_code" || action==="revoke_device" || action==="queue_signal" || action==="set_execution_controls" || action==="admin_list_devices"){
    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer ")) return reply({error:"Login diperlukan."},401);
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data,error}=await userClient.auth.getUser();
    if(error||!data.user) return reply({error:"Sesi login tidak valid."},401);
    const userId=data.user.id;

    // Fail closed, but resolve the subscription -> plan relation explicitly.
    // Some Supabase deployments return the nested plans relation inconsistently;
    // querying plan IDs separately avoids a false 403 for a valid Elite subscription.
    const entitlement=await getAccountAccess(admin,userId);
    if(entitlement.error) return reply({error:"Tidak dapat memverifikasi role dan paket akun.",detail:entitlement.error},503);
    if(!entitlement.allowed) return reply({
      error:"Akun customer memerlukan paket Elite/Enterprise aktif. Akun OWNER/ADMIN/SUPER_ADMIN mendapat akses penuh tanpa langganan.",
      diagnostic:{account_role:entitlement.role,active_subscription_count:entitlement.subscriptionCount,recognized_plan_codes:entitlement.planCodes}
    },403);

    if(action==="check_access"){
      return reply({allowed:true,role:entitlement.role,planCodes:entitlement.planCodes});
    }
    if(action==="admin_list_devices"){
      if(!["owner","admin","super_admin"].includes(entitlement.role)) return reply({error:"Monitoring perangkat hanya untuk admin."},403);
      const {data:devices,error:devicesErr}=await admin.from("mt5_devices").select("id,user_id,broker,account_profile,is_demo,terminal_server,account_login,symbol_name,enabled,last_seen_at,created_at").order("last_seen_at",{ascending:false}).limit(200);
      if(devicesErr) return reply({error:"Gagal membaca daftar perangkat MT5.",detail:devicesErr.message},503);
      return reply({status:"ok",devices:devices||[]});
    }
    if(action==="set_execution_controls"){
      if(!["owner","admin","super_admin"].includes(entitlement.role)) return reply({error:"Hanya OWNER/ADMIN yang boleh mengubah kontrol eksekusi."},403);
      const deviceId=clean(body.device_id,64);
      const mode=clean(body.execution_mode,20).toUpperCase();
      if(!deviceId || !["SEMI_AUTO","FULL_AUTO"].includes(mode)) return reply({error:"Perangkat atau mode tidak valid."},400);
      const risk=Number(body.max_risk_pct), daily=Number(body.max_daily_loss_pct);
      const spread=Number(body.max_spread_points), positions=Number(body.max_open_positions);
      if(!Number.isFinite(risk)||risk<=0||risk>0.5||!Number.isFinite(daily)||daily<=0||daily>2||
         !Number.isInteger(spread)||spread<1||spread>80||!Number.isInteger(positions)||positions<1||positions>1)
        return reply({error:"Batas demo: risiko maksimal 0.5% per posisi, rugi harian maksimal 2%, spread maksimal 80 points, dan maksimal 1 posisi."},400);
      const patch={execution_mode:mode,emergency_stop:body.emergency_stop!==false,max_risk_pct:risk,
        max_daily_loss_pct:daily,max_spread_points:spread,max_open_positions:positions};
      const {data:updated,error:updateErr}=await admin.from("mt5_devices").update(patch)
        .eq("id",deviceId).eq("user_id",userId).select("id,execution_mode,emergency_stop,max_risk_pct,max_daily_loss_pct,max_spread_points,max_open_positions,is_demo").maybeSingle();
      if(updateErr||!updated) return reply({error:"Gagal memperbarui kontrol atau terminal tidak ditemukan."},500);
      return reply({status:"ok",controls:updated});
    }
    if(action==="create_pairing_code"){
      const broker=clean(body.broker,24).toUpperCase(), profile=clean(body.account_profile,24).toUpperCase();
      const expectedDemo=body.is_demo!==false;
      if(!validBroker(broker)||!validProfile(broker,profile)) return reply({error:"Broker atau tipe akun tidak valid."},400);
      const code=randomToken(6).toUpperCase();
      const {error:insertErr}=await admin.from("mt5_pairing_codes").insert({user_id:userId,code_hash:await sha(code),broker,account_profile:profile,expected_demo:expectedDemo,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
      if(insertErr) return reply({error:"Gagal membuat kode pairing."},500);
      return reply({status:"ok",pairing_code:code,expires_in_seconds:600,instructions:expectedDemo?"Masukkan kode ini satu kali ke terminal MT5 DEMO. Kode tidak dapat digunakan ulang.":"Masukkan kode ini satu kali ke terminal MT5 REAL. Pairing Real hanya mengaktifkan koneksi dan pemantauan; eksekusi order Real tetap terkunci sampai lulus validasi keamanan."});
    }
    if(action==="revoke_device"){
      const id=clean(body.device_id,64);
      const {error:revokeErr}=await admin.from("mt5_devices").update({enabled:false}).eq("id",id).eq("user_id",userId);
      if(revokeErr) return reply({error:"Gagal mencabut perangkat."},500);
      return reply({status:"ok",revoked:true});
    }
    if(action==="queue_signal"){
      const deviceId=clean(body.device_id,64), symbol=clean(body.symbol,"12").toUpperCase();
      if(symbol!=="XAUUSD") return reply({error:"Tahap pertama hanya mengizinkan XAUUSD."},400);
      const {data:device}=await admin.from("mt5_devices").select("id,emergency_stop,is_demo").eq("id",deviceId).eq("user_id",userId).eq("enabled",true).eq("is_demo",body.is_demo===true).maybeSingle();
      if(!device) return reply({error:"Terminal aktif untuk mode akun ini tidak ditemukan."},403);
      if(device.emergency_stop) return reply({error:"Emergency Stop aktif. Sinyal baru diblokir."},423);
      const signal=clean(body.signal_type,20).toUpperCase();
      if(!["BUY","SELL","BUY_LIMIT","SELL_LIMIT","CANCEL"].includes(signal)) return reply({error:"Jenis sinyal tidak valid."},400);
      const payload=body.payload&&typeof body.payload==="object"?body.payload:{};
      // Require complete risk levels; this bridge queues instructions only and never bypasses the EA's local checks.
      if(signal!=="CANCEL"){
        for(const key of ["entry","stop_loss","take_profit_1"]) if(!Number.isFinite(Number(payload[key]))||Number(payload[key])<=0) return reply({error:"Sinyal ditolak: entry, stop_loss, dan take_profit_1 wajib berupa angka positif."},400);
      }
      const {data:row,error:queueErr}=await admin.from("mt5_signal_queue").insert({user_id:userId,device_id:deviceId,symbol,signal_type:signal,payload,expires_at:new Date(Date.now()+60*1000).toISOString()}).select("id,expires_at").single();
      if(queueErr) return reply({error:"Gagal memasukkan sinyal ke antrean."},500);
      return reply({status:"ok",queued:true,signal_id:row.id,expires_at:row.expires_at,mode:device.is_demo?"DEMO_ONLY":"REAL"});
    }
  }

  if(action==="pair_terminal"){
    const code=clean(body.pairing_code,64).toUpperCase(), broker=clean(body.broker,24).toUpperCase(), profile=clean(body.account_profile,24).toUpperCase();
    if(!code||!validBroker(broker)||!validProfile(broker,profile)||typeof body.is_demo!=="boolean") return reply({error:"Pairing memerlukan broker, tipe akun, dan status Demo/Real yang valid."},400);
    const {data:pair,error}=await admin.from("mt5_pairing_codes").select("*").eq("code_hash",await sha(code)).is("used_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
    if(error||!pair||pair.broker!==broker||pair.account_profile!==profile||pair.expected_demo!==body.is_demo) return reply({error:"Kode pairing tidak valid, kedaluwarsa, atau profil akun tidak cocok."},403);
    const token=randomToken(32);
    const {data:device,error:deviceErr}=await admin.from("mt5_devices").insert({
      user_id:pair.user_id,token_hash:await sha(token),broker,account_profile:profile,is_demo:body.is_demo,
      terminal_server:clean(body.server,120),account_login:clean(body.login,40),
      symbol_name:clean(body.symbol,32),symbol_digits:Number.isInteger(body.digits)?body.digits:null,
      contract_size:Number.isFinite(Number(body.contract_size))?Number(body.contract_size):null,
      volume_min:Number.isFinite(Number(body.volume_min))?Number(body.volume_min):null,
      volume_max:Number.isFinite(Number(body.volume_max))?Number(body.volume_max):null,
      volume_step:Number.isFinite(Number(body.volume_step))?Number(body.volume_step):null,
      execution_mode:body.is_demo?"SEMI_AUTO":"FULL_AUTO",
      emergency_stop:body.is_demo?true:false,
      max_risk_pct:0.25,
      max_daily_loss_pct:2,
      max_spread_points:80,
      max_open_positions:1,
      last_seen_at:new Date().toISOString()
    }).select("id").single();
    if(deviceErr) return reply({error:"Gagal mendaftarkan terminal."},500);
    await admin.from("mt5_pairing_codes").update({used_at:new Date().toISOString()}).eq("id",pair.id).is("used_at",null);
    return reply({status:"ok",device_id:device.id,device_token:token,warning:body.is_demo?"Simpan token ini secara privat. Terminal DEMO dipasangkan dengan Emergency Stop aktif.":"Simpan token ini secara privat. Terminal REAL hanya terhubung untuk pemantauan; eksekusi order Real tetap dikunci dan Emergency Stop aktif."});
  }

  const auth=req.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7).trim():clean(body.device_token,256);
  if(!token) return reply({error:"Token terminal diperlukan."},401);
  const {data:device,error:deviceErr}=await admin.from("mt5_devices").select("*").eq("token_hash",await sha(token)).eq("enabled",true).maybeSingle();
  if(deviceErr||!device) return reply({error:"Token terminal tidak valid atau perangkat dinonaktifkan."},401);

  // Re-check entitlement on every terminal operation. A downgraded account
  // cannot keep a previously paired terminal connected.
  const entitlement=await getAccountAccess(admin,device.user_id);
  if(entitlement.error) return reply({error:"Tidak dapat memverifikasi hak akses terminal.",detail:entitlement.error},503);
  if(!entitlement.allowed){
    await admin.from("mt5_devices").update({enabled:false}).eq("id",device.id);
    return reply({
      error:"Akses MT5 customer dikunci karena paket Elite/Enterprise tidak aktif. OWNER/ADMIN/SUPER_ADMIN tetap memiliki akses penuh.",
      diagnostic:{account_role:entitlement.role,active_subscription_count:entitlement.subscriptionCount,recognized_plan_codes:entitlement.planCodes}
    },403);
  }

  if(action==="heartbeat"){
    const patch:Obj={last_seen_at:new Date().toISOString()};
    if(body.symbol) patch.symbol_name=clean(body.symbol,32);
    if(Number.isInteger(body.digits)) patch.symbol_digits=body.digits;
    for(const k of ["contract_size","volume_min","volume_max","volume_step"]) if(Number.isFinite(Number(body[k]))) patch[k]=Number(body[k]);
    if(typeof body.is_demo!=="boolean" || body.is_demo!==device.is_demo) { await admin.from("mt5_devices").update({enabled:false}).eq("id",device.id); return reply({error:"Mode akun berubah/tidak cocok. Pairing ulang diperlukan."},403); }
    if(body.account_currency) patch.account_currency=clean(body.account_currency,12);
    if(Number.isFinite(Number(body.leverage))) patch.account_leverage=Math.max(1,Math.min(10000,Number(body.leverage)));
    if(Number.isFinite(Number(body.bid)) && Number(body.bid)>0) patch.last_bid=Number(body.bid);
    if(Number.isFinite(Number(body.ask)) && Number(body.ask)>0) patch.last_ask=Number(body.ask);
    if(Number.isFinite(Number(body.spread_points)) && Number(body.spread_points)>=0) patch.last_spread_points=Number(body.spread_points);
    if(body.tick_time) { const tick=new Date(body.tick_time); if(!Number.isNaN(tick.getTime())) patch.last_tick_at=tick.toISOString(); }
    await admin.from("mt5_devices").update(patch).eq("id",device.id);
    return reply({status:"ok",heartbeat:true,device_id:device.id});
  }
  if(action==="poll"){
    // Treat a successful authenticated poll as live terminal activity too.
    // The Admin dashboard derives Online/Offline from last_seen_at.
    const {error:seenErr}=await admin.from("mt5_devices").update({last_seen_at:new Date().toISOString()}).eq("id",device.id);
    if(seenErr) return reply({error:"Gagal memperbarui waktu aktivitas terminal."},503);
    const {data:controls,error:controlErr}=await admin.from("mt5_devices")
      .select("execution_mode,emergency_stop,max_risk_pct,max_daily_loss_pct,max_spread_points,max_open_positions,is_demo,enabled")
      .eq("id",device.id).single();
    if(controlErr || !controls) return reply({error:"Kontrol perangkat tidak dapat diverifikasi; polling dihentikan."},503);
    if(controls.enabled!==true) return reply({error:"Terminal tidak aktif; polling dihentikan."},403);
    // REAL and DEMO use identical strict risk checks. REAL remains paused until
    // the authenticated account owner explicitly selects FULL_AUTO and disables Emergency Stop.
    if(controls.emergency_stop===true)
      return reply({status:"paused",signals:[],controls,device_id:device.id,mode:device.is_demo?"DEMO_ONLY":"REAL",
        message:"Emergency Stop aktif. Sinyal tetap di antrean dan tidak diklaim."},200);
    if(!["SEMI_AUTO","FULL_AUTO"].includes(String(controls.execution_mode||"")))
      return reply({error:"Mode eksekusi tidak valid; polling dihentikan."},409);
    if(Number(controls.max_risk_pct)<=0 || Number(controls.max_risk_pct)>0.5 ||
       Number(controls.max_daily_loss_pct)<=0 || Number(controls.max_daily_loss_pct)>2 ||
       Number(controls.max_spread_points)<1 || Number(controls.max_spread_points)>80 ||
       Number(controls.max_open_positions)!==1)
      return reply({error:"Kontrol risiko perangkat di luar batas DEMO yang diizinkan; polling dihentikan."},409);
    const {data:rows,error:pollErr}=await admin.rpc("claim_mt5_signals",{p_device_id:device.id});
    if(pollErr) return reply({error:"Gagal mengunci antrean sinyal.",detail:pollErr.message},500);
    return reply({status:"ok",signals:rows||[],controls,device_id:device.id,mode:device.is_demo?"DEMO_ONLY":"REAL",execution_enabled:true});
  }
  if(action==="receipt"){
    const id=clean(body.signal_id,64), status=clean(body.status,20).toUpperCase();
    if(!["EXECUTED","REJECTED","EXPIRED","CANCELLED"].includes(status)) return reply({error:"Status receipt tidak valid."},400);
    if(!id) return reply({error:"ID sinyal wajib diisi."},400);
    // Only a signal actually claimed by this paired device may be completed.
    // Return 409 when no row changes; never report a receipt as saved falsely.
    const {data:receipt,error:receiptErr}=await admin.from("mt5_signal_queue")
      .update({status,completed_at:new Date().toISOString(),execution_result:body.result&&typeof body.result==="object"?body.result:{}})
      .eq("id",id).eq("device_id",device.id).eq("status","CLAIMED")
      .select("id,status").maybeSingle();
    if(receiptErr) return reply({error:"Gagal menyimpan receipt."},500);
    if(!receipt) return reply({error:"Receipt ditolak: sinyal tidak ditemukan, bukan milik perangkat ini, atau belum berstatus CLAIMED."},409);
    return reply({status:"ok",receipt_saved:true,signal_id:receipt.id,final_status:receipt.status});
  }
  return reply({error:"Aksi tidak dikenal."},400);
});
