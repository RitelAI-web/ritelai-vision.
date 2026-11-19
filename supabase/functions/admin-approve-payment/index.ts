// Secure manual QRIS/DANA payment review. No automatic payment verification.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return reply({error:"Method tidak didukung."},405);
 try{
  const auth=req.headers.get("Authorization")||"";if(!auth.startsWith("Bearer "))return reply({error:"Autentikasi diperlukan."},401);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;if(!url||!anon||!service)return reply({error:"Konfigurasi Supabase belum lengkap."},503);
  const uc=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}}),{data:u,error:ue}=await uc.auth.getUser();if(ue||!u.user)return reply({error:"Sesi tidak valid."},401);
  const db=createClient(url,service,{auth:{persistSession:false}}),{data:p,error:pe}=await db.from("profiles").select("role").eq("id",u.user.id).maybeSingle();if(pe||!p||!["owner","admin","super_admin"].includes(String(p.role||"").toLowerCase()))return reply({error:"Hanya OWNER/ADMIN yang dapat memverifikasi pembayaran."},403);
  const {proofId,decision}=await req.json();if(typeof proofId!=="string"||!/^[0-9a-f-]{36}$/i.test(proofId)||!["approved","rejected"].includes(decision))return reply({error:"Parameter tidak valid."},400);
  const {data:proof,error:fe}=await db.from("payment_proofs").select("id,user_id,plan_id,amount_idr,status,promo_code,original_amount_idr,discount_amount_idr").eq("id",proofId).maybeSingle();if(fe)throw fe;if(!proof)return reply({error:"Bukti pembayaran tidak ditemukan."},404);if(proof.status!=="pending")return reply({error:`Bukti sudah diproses: ${proof.status}`},409);
  const {data:claim,error:claimErr}=await db.from("payment_proofs").update({status:"processing",reviewed_by:u.user.id,reviewed_at:new Date().toISOString()}).eq("id",proofId).eq("status","pending").select("id").maybeSingle();if(claimErr)throw claimErr;if(!claim)return reply({error:"Bukti sedang atau sudah diproses admin lain."},409);
  try{
   if(decision==="approved"){
    const {data:plan,error:plErr}=await db.from("plans").select("id,code,duration_days,is_active,price_idr").eq("id",proof.plan_id).maybeSingle();if(plErr)throw plErr;if(!plan||!plan.is_active)throw new Error("Paket tidak aktif.");
    if(proof.promo_code){
     const code=String(proof.promo_code).trim().toUpperCase(),planCode=String(plan.code||"").toLowerCase();
     const original=Number(proof.original_amount_idr),discount=Number(proof.discount_amount_idr),expectedDiscount=Math.round(Number(plan.price_idr)*0.30);
     if(code!=="RITELAI30"||!["pro","elite"].includes(planCode))throw new Error("Kode promo tidak berlaku untuk paket ini.");
     if(original!==Number(plan.price_idr)||discount!==expectedDiscount||Number(proof.amount_idr)!==original-discount)throw new Error("Nominal promo tidak sesuai harga paket dan diskon 30%.");
     const [{data:priorSubs,error:subsErr},{data:priorProofs,error:proofsErr},{data:priorPromo,error:promoErr}]=await Promise.all([
      db.from("subscriptions").select("id").eq("user_id",proof.user_id).limit(1),
      db.from("payment_proofs").select("id").eq("user_id",proof.user_id).eq("status","approved").neq("id",proofId).limit(1),
      db.from("promo_redemptions").select("id").eq("user_id",proof.user_id).limit(1)
     ]);
     if(subsErr)throw subsErr;if(proofsErr)throw proofsErr;if(promoErr)throw promoErr;
     if(priorSubs?.length||priorProofs?.length||priorPromo?.length)throw new Error("Promo hanya berlaku untuk pembelian pertama pelanggan baru.");
     const {error:redemptionError}=await db.from("promo_redemptions").insert({user_id:proof.user_id,proof_id:proofId,promo_code:code,plan_id:proof.plan_id,original_amount_idr:original,discount_amount_idr:discount});
     if(redemptionError)throw new Error("Promo sudah pernah digunakan atau gagal diklaim: "+redemptionError.message);
    }else if(Number(plan.price_idr)!==Number(proof.amount_idr)){
     throw new Error("Nominal bukti tidak cocok dengan harga paket.");
    }
    const now=new Date(),{data:existing,error:exErr}=await db.from("subscriptions").select("ends_at").eq("user_id",proof.user_id).eq("status","active").gt("ends_at",now.toISOString()).order("ends_at",{ascending:false}).limit(1).maybeSingle();if(exErr)throw exErr;
    const start=existing?.ends_at&&new Date(existing.ends_at)>now?new Date(existing.ends_at):now,end=new Date(start);end.setUTCDate(end.getUTCDate()+Math.max(1,Number(plan.duration_days)||30));
    const {error:insErr}=await db.from("subscriptions").insert({user_id:proof.user_id,plan_id:proof.plan_id,status:"active",starts_at:start.toISOString(),ends_at:end.toISOString()});if(insErr)throw insErr;
   }
   const {error:doneErr}=await db.from("payment_proofs").update({status:decision,reviewed_by:u.user.id,reviewed_at:new Date().toISOString()}).eq("id",proofId).eq("status","processing");if(doneErr)throw doneErr;
  }catch(err){await db.from("promo_redemptions").delete().eq("proof_id",proofId);await db.from("payment_proofs").update({status:"pending",reviewed_by:null,reviewed_at:null}).eq("id",proofId).eq("status","processing");throw err;}
  await db.from("audit_logs").insert({actor_id:u.user.id,action:`payment_${decision}`,target_type:"payment_proofs",target_id:proofId,details:{user_id:proof.user_id,plan_id:proof.plan_id,amount_idr:proof.amount_idr}});
  return reply({success:true,proofId,status:decision,subscription_created:decision==="approved"});
 }catch(e){console.error("admin-approve-payment",e);return reply({error:e instanceof Error?e.message:"Pemrosesan pembayaran gagal."},500);}
});