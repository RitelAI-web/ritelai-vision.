from pathlib import Path

# This patch runs after the ZIP package is extracted into site/.
# Keep the asset selector enhancement, but never inject fabricated signals,
# invented accuracy percentages, coupon entitlements, or DOM-wide text rewrites.
p = Path("site/index.html")
if not p.is_file():
    raise SystemExit("site/index.html missing")

html = p.read_text(encoding="utf-8")

options = {
    "KRIPTO": [("BTCUSD", "Bitcoin / USD"), ("ETHUSD", "Ethereum / USD"), ("SOLUSD", "Solana / USD")],
    "FOREX": [("EURUSD", "Euro / Dolar AS"), ("GBPUSD", "Poundsterling / Dolar AS"), ("USDJPY", "US Dollar / Yen Jepang")],
    "KOMODITAS": [("XAUUSD", "Emas / USD"), ("XAGUSD", "Perak / USD"), ("WTIUSD", "Minyak Mentah WTI")],
    "INDEKS": [("US30", "Dow Jones"), ("US500", "S&P 500"), ("NAS100", "Nasdaq 100")],
    "SAHAM": [("AAPL", "Apple"), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"), ("AMZN", "Amazon")],
}

new_select = ['<select id="asset" class="field mb-3">']
for group, items in options.items():
    new_select.append(f'<optgroup label="{group}">')
    for symbol, label in items:
        selected = ' selected' if symbol == "XAUUSD" else ""
        new_select.append(f'<option value="{symbol}"{selected}>{label}</option>')
    new_select.append("</optgroup>")
new_select.append("</select>")
new_select = "".join(new_select)

# Replace only the known original selector prefix; leave all unrelated UI intact.
old_prefix = '<select id="asset" class="field mb-3"><option value="XAUUSD">Emas / USD</option>'
if old_prefix in html:
    html = html.replace(old_prefix, new_select, 1)
elif 'id="asset"' not in html:
    raise SystemExit("Asset selector not found; refusing to modify unknown markup")

p.write_text(html, encoding="utf-8")
print("RitelAI frontend patch applied: market selector only; no fabricated indicator cards.")

# Add a working, mobile-friendly user settings screen. Preferences are local to
# this browser; they do not pretend to change server-side AI prompts or secrets.
nav_anchor = '  <button class="navbtn" data-tab="history" onclick="showTab(\'history\',this)"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Riwayat</button>'
nav_settings = '  <button class="navbtn" data-tab="settings" onclick="showTab(\'settings\',this)"><i class="fa-solid fa-gear mr-1"></i>Pengaturan</button>'
if 'data-tab="settings"' not in html:
    if nav_anchor not in html:
        raise SystemExit("Navigation anchor not found; refusing to inject settings into unknown layout")
    html = html.replace(nav_anchor, nav_anchor + "\n" + nav_settings, 1)


# Add an Investing-style economic calendar with Previous / Forecast / Actual
# and AI scenario commentary. Values are rendered only when supplied by provider.
macro_nav = """  <button class="navbtn" data-tab="macro-calendar" onclick="showTab('macro-calendar',this)"><i class="fa-solid fa-calendar-days mr-1"></i>Kalender Ekonomi</button>"""
if 'data-tab="macro-calendar"' not in html:
    nav_anchor = """  <button class="navbtn" data-tab="history" onclick="showTab('history',this)"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Riwayat</button>"""
    if nav_anchor not in html:
        raise SystemExit("Navigation anchor for economic calendar not found")
    html = html.replace(nav_anchor, nav_anchor + "\n" + macro_nav, 1)

macro_panel = """
 <section id="tab-macro-calendar" class="panel">
  <div class="mb-4"><div class="text-[10px] tracking-widest text-cyan-300 font-bold">MACRO EVENT INTELLIGENCE</div><h2 class="text-xl font-extrabold">Kalender Ekonomi</h2><p class="muted text-xs mt-1">Previous · Forecast · Actual · Revisi · Analisis skenario AI</p></div>
  <div class="flex gap-2 flex-wrap mb-3"><button class="btn primary" onclick="loadRitelMacroCalendar()">Perbarui kalender</button><span id="macroCalendarStatus" class="muted text-xs self-center">Memuat data kalender...</span></div>
  <div id="ritelMacroCalendarList" class="space-y-3"><div class="glass rounded-xl p-4 muted text-xs">Mengambil agenda ekonomi...</div></div>
  <p class="muted text-[10px] mt-3">Actual/Forecast/Previous berasal dari feed kalender jika tersedia. Prediksi AI adalah skenario terpisah, bukan konsensus pasar atau jaminan arah harga.</p>
 </section>
"""
if 'id="tab-macro-calendar"' not in html:
    anchor = ' <section id="tab-settings" class="panel">'
    if anchor in html:
        html = html.replace(anchor, macro_panel + "\n" + anchor, 1)
    elif "</body>" in html:
        html = html.replace("</body>", macro_panel + "\n</body>", 1)
    else:
        raise SystemExit("No safe insertion point for economic calendar panel")

macro_js = r'''
function macroSafe(v){return escapeHtml(String(v==null||v===""?"—":v))}
function macroTime(v){if(!v)return "Waktu belum tersedia";const d=new Date(v);return Number.isNaN(d.getTime())?macroSafe(v):d.toLocaleString("id-ID",{timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"})+" WIB"}
function macroCard(e){
 const v=e.valueDisplay||{},ai=e.ai||e.analysis||e.impactAnalysis||{},imp=String(e.importance||"").toUpperCase();
 const actual=e.actual??v.actual,forecast=e.forecast??v.forecast,previous=e.previous??v.previous,revised=e.revisedPrevious??v.revisedPrevious;
 const status=e.releaseStatus==="RELEASED"||actual!=null&&actual!==""?"RELEASED":"UPCOMING";
 const assets=Array.isArray(ai.assets)?ai.assets:Array.isArray(ai.results)?ai.results:[];
 const aiText=ai.reason||ai.summary||e.analysisReason||e.impact||"Analisis AI belum tersedia untuk agenda ini.";
 const scores=assets.map(x=>'<div class="border-t border-slate-700 pt-2 mt-2"><div class="flex justify-between text-xs"><b>'+macroSafe(x.symbol||x.asset||x.instrument)+'</b><b>'+macroSafe(x.decision||x.signal||"WAIT")+'</b></div><div class="muted text-[10px] mt-1">'+macroSafe(x.reason||x.analysis||"Alasan belum tersedia")+'</div></div>').join("");
 const surprise=e.actualVsForecast||"PENDING";
 return '<article class="glass rounded-2xl p-4 border border-slate-700"><div class="flex flex-wrap items-center justify-between gap-2"><div class="flex gap-2 items-center"><span class="pill text-cyan-200">'+macroSafe(e.currency||e.countryCode||"—")+'</span><span class="pill '+(imp.includes("HIGH")||imp==="3"?"text-rose-300":"text-amber-200")+'">'+macroSafe(imp||"IMPACT —")+'</span></div><span class="text-[10px] '+(status==="RELEASED"?"text-emerald-300":"text-cyan-200")+'">'+status+'</span></div><h3 class="font-bold mt-3">'+macroSafe(e.name||e.title||"Agenda ekonomi")+'</h3><p class="muted text-[11px] mt-1">'+macroTime(e.time||e.date||e.timestamp)+'</p><div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3"><div class="rounded-lg bg-slate-950/70 p-2"><div class="muted text-[10px]">Previous</div><b class="text-sm">'+macroSafe(previous)+'</b></div><div class="rounded-lg bg-slate-950/70 p-2"><div class="muted text-[10px]">Forecast</div><b class="text-sm">'+macroSafe(forecast)+'</b></div><div class="rounded-lg bg-slate-950/70 p-2"><div class="muted text-[10px]">Actual</div><b class="text-sm '+(status==="RELEASED"?"text-emerald-300":"")+'">'+macroSafe(actual)+'</b></div><div class="rounded-lg bg-slate-950/70 p-2"><div class="muted text-[10px]">Previous revised</div><b class="text-sm">'+macroSafe(revised)+'</b></div></div><div class="text-[10px] muted mt-2">Perbandingan: '+macroSafe(surprise)+' · Sumber: '+macroSafe(e.eventSource||e.source||"feed kalender")+'</div><div class="rounded-xl bg-slate-950/60 p-3 mt-3"><b class="text-xs text-cyan-200">Analisis dampak AI</b><p class="text-xs mt-2">'+macroSafe(aiText)+'</p>'+scores+'</div></article>';
}
let ritelMacroRefreshTimer=null,ritelMacroLoading=false,ritelMacroEvents=[];
function ritelMacroRefreshDelay(){
 const now=Date.now();
 const near=ritelMacroEvents.some(e=>{const t=Date.parse(e.time||e.date||e.timestamp||"");return Number.isFinite(t)&&t>=now-15*60*1000&&t<=now+30*60*1000;});
 return near?60*1000:5*60*1000;
}
function scheduleRitelMacroRefresh(){
 if(ritelMacroRefreshTimer)clearTimeout(ritelMacroRefreshTimer);
 const delay=ritelMacroRefreshDelay();
 ritelMacroRefreshTimer=setTimeout(()=>{
  if(document.visibilityState==="visible")loadRitelMacroCalendar();
  else scheduleRitelMacroRefresh();
 },delay);
}
async function loadRitelMacroCalendar(){
 const list=document.getElementById("ritelMacroCalendarList"),status=document.getElementById("macroCalendarStatus");if(!list||ritelMacroLoading)return;
 ritelMacroLoading=true;
 status.textContent="Memperbarui otomatis...";
 try{
  const request=supabaseClient.functions.invoke("quick-service",{body:{action:"market_calendar",assets:["XAUUSD","BTCUSD","EURUSD","GBPUSD","USDJPY","US30"]}});
  const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error("Permintaan kalender melewati 25 detik. Periksa koneksi atau status Edge Function Supabase.")),25000));
  const {data,error}=await Promise.race([request,timeout]);
  if(error)throw error;
  const events=Array.isArray(data?.events)?data.events:[];
  ritelMacroEvents=events;
  if(!events.length){list.innerHTML='<div class="glass rounded-xl p-4 text-xs text-amber-200">Feed belum mengirim agenda. Coba perbarui kembali.</div>';status.textContent="0 agenda · pembaruan otomatis aktif";return;}
  list.innerHTML=events.map(macroCard).join("");
  const delay=ritelMacroRefreshDelay();
  status.textContent=events.length+" agenda · diperbarui "+new Date().toLocaleTimeString("id-ID")+" · otomatis "+(delay<120000?"1 menit":"5 menit");
 }catch(err){status.textContent="Gagal memuat · mencoba lagi otomatis";list.innerHTML='<div class="glass rounded-xl p-4 text-xs text-amber-200">Kalender belum dapat dimuat: '+macroSafe(err.message||err)+'</div>';}
 finally{ritelMacroLoading=false;scheduleRitelMacroRefresh();}
}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){if(ritelMacroRefreshTimer)clearTimeout(ritelMacroRefreshTimer);loadRitelMacroCalendar();}});
'''
if 'function loadRitelMacroCalendar()' not in html:
    js_anchor = 'function readRitelSettings(){'
    if js_anchor in html:
        html=html.replace(js_anchor,macro_js+"\n"+js_anchor,1)
    elif "</script>" in html:
        pos=html.rfind("</script>")
        html=html[:pos]+macro_js+"\n"+html[pos:]
    else:
        raise SystemExit("No safe JavaScript insertion point for economic calendar")
if "loadRitelMacroCalendar();" not in html[html.rfind("window.addEventListener('DOMContentLoaded'"):]:
    html=html.replace("  applyRitelSettings();","  applyRitelSettings();\n  loadRitelMacroCalendar();",1)

settings_panel = '''
 <section id="tab-settings" class="panel">
  <div class="glass rounded-2xl p-5 mb-4">
   <div class="text-[10px] tracking-widest text-cyan-300 font-bold">AKUN & PENGALAMAN</div>
   <h2 id="settingsGreeting" class="text-2xl font-extrabold mt-2">Halo, selamat datang 👋</h2>
   <p id="settingsRole" class="muted text-xs mt-1">Memuat informasi akun...</p>
   <p class="muted text-xs mt-3">Semua pengaturan akun, keamanan, dan pengalaman RitelAI Vision dalam satu tempat.</p>
  </div>
  <div class="space-y-4">
   <div class="glass rounded-2xl p-4">
    <h3 class="font-bold text-sm mb-3">Informasi pribadi</h3>
    <label class="text-[11px] muted block mb-1">Nama tampilan</label><input id="profileDisplayName" class="field mb-3" maxlength="60" placeholder="Nama yang ingin ditampilkan">
    <label class="text-[11px] muted block mb-1">Alamat email</label><input id="profileEmail" type="email" class="field mb-2" disabled>
    <div class="flex flex-wrap gap-2 items-center"><span id="profileEmailStatus" class="pill text-amber-200">Memeriksa status email...</span><button id="profileResendVerification" class="btn border border-cyan-700 text-cyan-200 text-xs" onclick="resendRitelVerification()">Kirim ulang verifikasi</button></div>
    <p class="muted text-[10px] mt-2">Email login dikelola oleh sistem autentikasi. Perubahan email, jika diaktifkan, memerlukan konfirmasi email baru.</p>
    <button class="btn primary mt-3" onclick="saveRitelProfile()">Simpan nama</button>
    <p id="profileSaveNote" class="muted text-[10px] mt-2"></p>
   </div>
   <div class="glass rounded-2xl p-4">
    <h3 class="font-bold text-sm mb-3">Keamanan akun</h3>
    <label class="text-[11px] muted block mb-1">Password baru</label><input id="profileNewPassword" type="password" class="field mb-2" minlength="8" autocomplete="new-password" placeholder="Minimal 8 karakter">
    <button class="btn border border-cyan-700 text-cyan-200" onclick="changeRitelPassword()">Perbarui password</button>
    <p class="muted text-[10px] mt-2">Jangan bagikan password atau kode verifikasi kepada siapa pun.</p>
    <p id="securitySaveNote" class="muted text-[10px] mt-2"></p>
   </div>
   <div class="glass rounded-2xl p-4">
    <h3 class="font-bold text-sm mb-3">Pengalaman analisis</h3>
    <label class="text-[11px] muted block mb-1">Timeframe default</label><select id="prefTimeframe" class="field mb-3"><option>M5</option><option>M15</option><option>M30</option><option>H1</option><option>H4</option><option>D1</option></select>
    <label class="text-[11px] muted block mb-1">Modal akun default (USD)</label><input id="prefBalance" type="number" min="0" class="field mb-3" value="1000">
    <label class="text-[11px] muted block mb-1">Risiko default per transaksi (%)</label><input id="prefRisk" type="number" min="0.1" max="2" step="0.1" class="field mb-3" value="1">
    <div class="flex gap-2 flex-wrap"><button class="btn primary" onclick="saveRitelSettings()">Simpan pengalaman</button><button class="btn border border-slate-600" onclick="resetRitelSettings()">Pulihkan default</button></div>
    <p id="settingsSaveNote" class="muted text-[10px] mt-2">Preferensi disimpan pada perangkat ini.</p>
   </div>
   <div id="settingsAdminAccess" class="glass rounded-2xl p-4" hidden>
    <h3 class="font-bold text-sm mb-2">Akses Owner / Admin</h3>
    <p class="muted text-xs">Panel administrasi hanya ditampilkan untuk akun yang memiliki role resmi dari sistem.</p>
    <button class="btn border border-cyan-700 text-cyan-200 mt-3" onclick="showAdmin()">Buka Dashboard Admin</button>
   </div>
   <div class="glass rounded-2xl p-4">
    <h3 class="font-bold text-sm mb-2">Bantuan & preferensi</h3>
    <p class="muted text-xs">Pengaturan profil dan keamanan mengikuti status autentikasi. Preferensi analisis tersimpan di browser/perangkat ini.</p>
    <button class="btn border border-slate-600 mt-3" onclick="signOutRitelAccount()">Keluar dari akun</button>
    <p id="accountActionNote" class="muted text-[10px] mt-2"></p>
   </div>
  </div>
 </section>
'''
if 'id="tab-settings"' not in html:
    admin_anchor = ' <section id="tab-admin" class="panel">'
    if admin_anchor in html:
        html = html.replace(admin_anchor, settings_panel + "\n" + admin_anchor, 1)
    elif "</body>" in html:
        html = html.replace("</body>", settings_panel + "\n</body>", 1)
    else:
        raise SystemExit("No safe insertion point for settings panel")

settings_js = '''
let ritelSettingsUser=null;
function readRitelSettings(){try{return JSON.parse(localStorage.getItem('ritelai.userSettings')||'{}')}catch(_){return {}}}
async function loadRitelAccountSettings(){
 const greeting=document.getElementById('settingsGreeting'),roleLine=document.getElementById('settingsRole');
 try{
  const {data,error}=await supabaseClient.auth.getUser();if(error)throw error;
  const user=data?.user;ritelSettingsUser=user;
  if(!user){if(greeting)greeting.textContent='Halo, selamat datang 👋';if(roleLine)roleLine.textContent='Kamu belum masuk ke akun.';return;}
  const meta=user.user_metadata||{},app=user.app_metadata||{};
  const display=meta.full_name||meta.name||meta.display_name||user.email?.split('@')[0]||'Pengguna';
  const role=String(app.role||meta.role||'user').toLowerCase();
  const isOwner=['owner','super_admin','superadmin'].includes(role)||String(meta.login_id||'').toLowerCase()==='ritelai';
  const isAdmin=isOwner||role==='admin';
  if(greeting)greeting.textContent='Halo, '+(isOwner?'Owner':display)+' 👋';
  if(roleLine)roleLine.textContent=(isOwner?'Owner':isAdmin?'Admin':'Akun pengguna')+' · '+(user.email||'Email tidak tersedia');
  const name=document.getElementById('profileDisplayName'),email=document.getElementById('profileEmail'),status=document.getElementById('profileEmailStatus'),resend=document.getElementById('profileResendVerification');
  if(name)name.value=meta.full_name||meta.name||meta.display_name||'';
  if(email)email.value=user.email||'';
  const verified=Boolean(user.email_confirmed_at||user.confirmed_at);
  if(status){status.textContent=verified?'Email terverifikasi':'Email belum terverifikasi';status.className='pill '+(verified?'text-emerald-300':'text-amber-200');}
  if(resend)resend.hidden=verified;
  const admin=document.getElementById('settingsAdminAccess');if(admin)admin.hidden=!isAdmin;
 }catch(e){if(greeting)greeting.textContent='Halo, selamat datang 👋';if(roleLine)roleLine.textContent='Informasi akun belum dapat dimuat: '+(e.message||e);}
}
async function saveRitelProfile(){
 const note=document.getElementById('profileSaveNote'),name=String(document.getElementById('profileDisplayName')?.value||'').trim();
 if(!name){if(note)note.textContent='Nama tampilan tidak boleh kosong.';return;}
 try{const {data,error}=await supabaseClient.auth.updateUser({data:{full_name:name}});if(error)throw error;ritelSettingsUser=data?.user||ritelSettingsUser;if(note)note.textContent='Nama tampilan berhasil diperbarui.';await loadRitelAccountSettings();}
 catch(e){if(note)note.textContent='Gagal menyimpan nama: '+(e.message||e);}
}
async function resendRitelVerification(){
 const note=document.getElementById('profileSaveNote');try{const email=ritelSettingsUser?.email;if(!email)throw new Error('Email akun tidak ditemukan.');const {error}=await supabaseClient.auth.resend({type:'signup',email});if(error)throw error;if(note)note.textContent='Permintaan verifikasi dikirim. Periksa inbox dan folder spam.';}
 catch(e){if(note)note.textContent='Gagal mengirim verifikasi: '+(e.message||e);}
}
async function changeRitelPassword(){
 const note=document.getElementById('securitySaveNote'),password=document.getElementById('profileNewPassword')?.value||'';
 if(password.length<8){if(note)note.textContent='Password minimal 8 karakter.';return;}
 try{const {error}=await supabaseClient.auth.updateUser({password});if(error)throw error;document.getElementById('profileNewPassword').value='';if(note)note.textContent='Password berhasil diperbarui.';}
 catch(e){if(note)note.textContent='Gagal memperbarui password: '+(e.message||e);}
}
async function signOutRitelAccount(){
 const note=document.getElementById('accountActionNote');try{const {error}=await supabaseClient.auth.signOut();if(error)throw error;if(note)note.textContent='Kamu sudah keluar. Memuat ulang halaman...';setTimeout(()=>location.reload(),500);}
 catch(e){if(note)note.textContent='Gagal keluar: '+(e.message||e);}
}
function applyRitelSettings(){
 const s=readRitelSettings(),tf=document.getElementById('prefTimeframe'),bal=document.getElementById('prefBalance'),risk=document.getElementById('prefRisk');
 if(tf&&s.timeframe)tf.value=s.timeframe;if(bal&&s.balance!=null)bal.value=s.balance;if(risk&&s.risk!=null)risk.value=s.risk;
 const liveTf=document.getElementById('timeframe'),liveBal=document.getElementById('balance'),liveRisk=document.getElementById('risk');
 if(liveTf&&s.timeframe)liveTf.value=s.timeframe;if(liveBal&&s.balance!=null)liveBal.value=s.balance;if(liveRisk&&s.risk!=null)liveRisk.value=s.risk;
}
function saveRitelSettings(){
 const s={timeframe:document.getElementById('prefTimeframe').value,balance:Math.max(0,Number(document.getElementById('prefBalance').value)||0),risk:Math.min(2,Math.max(.1,Number(document.getElementById('prefRisk').value)||1))};
 try{localStorage.setItem('ritelai.userSettings',JSON.stringify(s));applyRitelSettings();document.getElementById('settingsSaveNote').textContent='Preferensi pengalaman berhasil disimpan pada perangkat ini.';toast('Pengaturan berhasil disimpan.');}catch(e){toast('Tidak dapat menyimpan pengaturan pada browser ini.');}
}
function resetRitelSettings(){try{localStorage.removeItem('ritelai.userSettings')}catch(_){};const tf=document.getElementById('prefTimeframe'),bal=document.getElementById('prefBalance'),risk=document.getElementById('prefRisk');if(tf)tf.value='M15';if(bal)bal.value='1000';if(risk)risk.value='1';const lt=document.getElementById('timeframe'),lb=document.getElementById('balance'),lr=document.getElementById('risk');if(lt)lt.value='M15';if(lb)lb.value='1000';if(lr)lr.value='1';document.getElementById('settingsSaveNote').textContent='Pengaturan default dipulihkan.';}
'''
if 'function saveRitelSettings()' not in html:
    js_anchor = 'function showTab(name,btn)'
    if js_anchor in html:
        html = html.replace(js_anchor, settings_js + "\n" + js_anchor, 1)
    elif "</script>" in html:
        pos = html.rfind("</script>")
        html = html[:pos] + settings_js + "\n" + html[pos:]
    else:
        raise SystemExit("No safe JavaScript insertion point for settings")

# Apply saved defaults after the page DOM exists.
if "applyRitelSettings();" not in html[html.rfind("window.addEventListener('DOMContentLoaded'"):]:
    html = html.replace("  startMarketAutoRefresh();", "  startMarketAutoRefresh();\n  applyRitelSettings();\n  loadRitelAccountSettings();", 1)


# Inject asset-aware headlines into the successful analysis result.
news_js = r"""
async function loadNewsForAnalysis(symbol){
 const target=document.getElementById('analysisNewsIntel');if(!target)return;
 target.innerHTML='<p class="muted text-xs">Memeriksa berita terbaru...</p>';
 try{
  const {data,error}=await supabaseClient.functions.invoke('quick-service',{body:{action:'market_news'}});
  if(error)throw error;
  const items=Array.isArray(data?.items)?data.items:[];
  const key=String(symbol||'').toUpperCase();
  const terms=key.includes('XAU')||key.includes('XAG')?['gold','silver','precious metal','fed','dollar','inflation']:key.includes('BTC')||key.includes('ETH')||key.includes('SOL')?['crypto','bitcoin','ethereum','digital asset','sec','etf']:key.includes('EUR')?['euro','ecb','europe','eurozone','dollar','fed']:key.includes('GBP')?['pound','sterling','boe','uk','britain','dollar']:key.includes('JPY')?['yen','boj','japan','dollar','fed']:key.includes('US30')||key.includes('US500')||key.includes('NAS')?['stock','equity','wall street','nasdaq','dow','s&p','fed','earnings']:[key.toLowerCase()];
  const ranked=items.map(n=>{const hay=(String(n.title||'')+' '+String(n.category||'')+' '+String(n.source||'')).toLowerCase();return {...n,score:terms.reduce((a,t)=>a+(hay.includes(t)?1:0),0)}}).filter(n=>n.score>0).sort((a,b)=>b.score-a.score||Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)).slice(0,5);
  const safe=v=>escapeHtml(String(v||''));const stamp=v=>v?new Date(v).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB':'Waktu publikasi tidak tersedia';
  target.innerHTML='<div class="flex justify-between items-center gap-2 mb-3"><b class="text-xs">LIVE NEWS INTELLIGENCE · '+safe(key)+'</b><span class="pill text-cyan-200">'+ranked.length+' berita cocok</span></div>'+(ranked.length?ranked.map(n=>'<article class="border-t border-slate-700 py-3"><a class="text-xs font-semibold text-cyan-200 underline" href="'+safe(n.url)+'" target="_blank" rel="noopener noreferrer">'+safe(n.title)+'</a><div class="muted text-[10px] mt-1">'+safe(n.source)+' · '+stamp(n.publishedAt)+' · '+safe(n.category)+'</div></article>').join(''):'<p class="text-xs text-amber-200">Belum ditemukan berita yang cocok dari feed saat ini. Periksa tab News & Kalender.</p>')+'<p class="muted text-[10px] mt-2">Sumber: Google News RSS. Berita merupakan konteks, bukan sinyal BUY/SELL otomatis. Feed dapat terlambat atau gagal.</p>';
 }catch(e){target.innerHTML='<b class="text-xs text-amber-200">News feed sementara tidak tersedia</b><p class="muted text-[10px] mt-1">'+escapeHtml(e.message||'Gagal mengambil berita')+'</p>';}
}
"""
if 'async function loadNewsForAnalysis(symbol)' not in html:
    anchor='function requestAnalysis(){'
    if anchor not in html: raise SystemExit("Analysis function not found in source HTML")
    html=html.replace("async "+anchor,news_js+"\nasync "+anchor,1)
render_anchor='   const putSummary=(id,value)=>'
render_add="""   const scenarioPanel=document.createElement('div');scenarioPanel.id='conditionalTradeScenarios';scenarioPanel.className='mt-4 text-left rounded-xl border border-cyan-900/60 bg-slate-950/70 p-4';const scenarioText=(v,fallback)=>escapeHtml(String(v||fallback));scenarioPanel.innerHTML='<div class="mb-3"><div class="text-[10px] tracking-widest text-cyan-300 font-bold">RENCANA DUA ARAH</div><h3 class="font-bold text-sm mt-1">Skenario BUY & SELL</h3><p class="muted text-[10px] mt-1">Kedua skenario bersyarat. Jika pemicu belum terpenuhi, keputusan tetap WAIT.</p></div><div class="grid grid-cols-1 sm:grid-cols-2 gap-3"><section class="rounded-xl border border-emerald-800/70 bg-slate-900 p-3"><b class="text-emerald-300 text-sm">BUY · Bersyarat</b><p class="text-xs mt-2">'+scenarioText(r.scenario_buy?.trigger,'Tunggu harga menembus resistance dan candle ditutup di atasnya.')+'</p><p class="text-xs mt-2">'+scenarioText(r.scenario_buy?.confirmation,'Konfirmasi retest bertahan dan indikator momentum menguat.')+'</p><p class="text-xs muted mt-2">Batal jika harga kembali di bawah area breakout.</p></section><section class="rounded-xl border border-rose-800/70 bg-slate-900 p-3"><b class="text-rose-300 text-sm">SELL · Bersyarat</b><p class="text-xs mt-2">'+scenarioText(r.scenario_sell?.trigger,'Tunggu rejection resistance atau breakdown support dengan candle bearish tertutup.')+'</p><p class="text-xs mt-2">'+scenarioText(r.scenario_sell?.confirmation,'Konfirmasi lower high, momentum bearish, dan retest gagal.')+'</p><p class="text-xs muted mt-2">Batal jika harga menembus resistance dan bertahan di atasnya.</p></section></div>';resultBox.appendChild(scenarioPanel);
   const newsPanel=document.createElement('div');newsPanel.id='analysisNewsIntel';newsPanel.className='mt-4 text-left rounded-xl border border-cyan-900/60 bg-slate-950/60 p-4';newsPanel.innerHTML='<p class="muted text-xs">Memuat berita relevan...</p>';resultBox.appendChild(newsPanel);await loadNewsForAnalysis(document.getElementById('asset').value);
"""
if render_anchor not in html: raise SystemExit("Analysis result insertion point not found")
html=html.replace(render_anchor,render_add+render_anchor,1)

p.write_text(html, encoding="utf-8")
print("RitelAI frontend patch applied: market selector and persistent user settings screen.")


# Add a separate live quote monitor and evidence-based pending-order panel.
# Quote polling is deliberately independent from screenshot-based AI analysis.
html = p.read_text(encoding="utf-8")
live_monitor_js = r"""
let ritelLiveQuoteTimer=null,ritelLiveQuoteBusy=false;
async function refreshRitelLiveQuote(){
 const panel=document.getElementById('ritelLiveQuote');
 if(!panel||ritelLiveQuoteBusy)return;
 ritelLiveQuoteBusy=true;
 try{
  const symbol=String(document.getElementById('asset')?.value||'XAUUSD').toUpperCase();
  const {data,error}=await supabaseClient.functions.invoke('quick-service',{body:{action:'market_quotes',symbol}});
  if(error)throw error;
  const q=data?.quote;
  if(!q){panel.innerHTML='<b class="text-amber-300 text-xs">STALE · Harga tidak tersedia</b><p class="muted text-[10px] mt-1">'+escapeHtml(data?.error||'Feed belum mengirim tick baru')+'</p>';return;}
  const live=q.status==='LIVE_TICK'&&!q.stale&&q.marketState!=='closed';
  panel.innerHTML='<div class="flex items-center justify-between gap-2"><b class="text-xs">PEMANTAUAN HARGA · '+escapeHtml(symbol)+'</b><span class="pill '+(live?'text-emerald-300':'text-amber-300')+'">'+(live?'LIVE FEED':q.marketState==='closed'?'MARKET CLOSED':'STALE')+'</span></div><div class="text-2xl font-extrabold mt-2">'+Number(q.price).toLocaleString('en-US',{maximumFractionDigits:5})+'</div><p class="muted text-[10px] mt-1">Sumber '+escapeHtml(q.source||'feed')+' · diperiksa '+new Date().toLocaleTimeString('id-ID')+'</p><p class="muted text-[10px] mt-1">Harga feed diperbarui terpisah; analisis screenshot tidak dihitung ulang setiap tick.</p>';
 }catch(e){panel.innerHTML='<b class="text-amber-300 text-xs">FEED TIDAK TERSEDIA</b><p class="muted text-[10px] mt-1">'+escapeHtml(e.message||e)+'</p>';}
 finally{ritelLiveQuoteBusy=false;}
}
function startRitelLiveQuoteMonitor(){
 if(ritelLiveQuoteTimer)clearInterval(ritelLiveQuoteTimer);
 refreshRitelLiveQuote();
 ritelLiveQuoteTimer=setInterval(()=>{if(document.visibilityState==='visible')refreshRitelLiveQuote();},5000);
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&document.getElementById('ritelLiveQuote'))refreshRitelLiveQuote();});
"""
if 'function startRitelLiveQuoteMonitor()' not in html:
    anchor='async function requestAnalysis(){'
    if anchor not in html: raise SystemExit("Analysis function not found for live quote monitor")
    html=html.replace(anchor,live_monitor_js+"\n"+anchor,1)

pending_ui = r"""
const quotePanel=document.createElement('div');
quotePanel.id='ritelLiveQuote';
quotePanel.className='mt-4 text-left rounded-xl border border-cyan-900/60 bg-slate-950/70 p-4';
quotePanel.innerHTML='<p class="muted text-xs">Menghubungkan feed harga...</p>';
resultBox.appendChild(quotePanel);
startRitelLiveQuoteMonitor();
const pending=r.pending_orders||{};
const renderPendingOrder=(o,label)=>{
 o=o||{};
 const n=v=>v==null?'—':escapeHtml(String(v));
 const valid=o.status==='VALID_SETUP'&&o.entry_price!=null&&o.stop_loss!=null&&o.take_profit_1!=null;
 return '<section class="rounded-xl border border-slate-700 bg-slate-900 p-3"><div class="flex justify-between gap-2"><b class="text-sm">'+label+'</b><span class="pill text-amber-200">'+n(o.status||'WAIT_CONFIRMATION')+'</span></div><p class="text-xs mt-2">Zona: '+n(o.zone_type)+' · '+n(o.entry_zone_low)+' – '+n(o.entry_zone_high)+'</p><p class="text-xs mt-1">Entry: '+n(o.entry_price)+' · SL: '+n(o.stop_loss)+' · TP1: '+n(o.take_profit_1)+' · TP2: '+n(o.take_profit_2)+'</p><p class="text-xs mt-2">'+n(o.rationale||'Bukti zona belum cukup.')+'</p><p class="muted text-[10px] mt-2">Skor kualitas setup: '+n(o.confidence_score)+'/100 · Akurasi historis: belum tersedia</p><p class="muted text-[10px] mt-1">Invalidasi: '+n(o.invalidation)+'</p>'+(valid?'':'<p class="text-[10px] text-amber-200 mt-2">Jangan pasang order: setup/level belum tervalidasi.</p>')+'</section>';
};
const orderPanel=document.createElement('div');
orderPanel.className='mt-4 text-left rounded-xl border border-cyan-900/60 bg-slate-950/70 p-4';
orderPanel.innerHTML='<b class="text-xs text-cyan-200">PENDING ORDER INTELLIGENCE</b><p class="muted text-[10px] mt-1">Limit adalah rencana bersyarat; tidak dikirim ke broker.</p><div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">'+renderPendingOrder(pending.buy_limit,'BUY LIMIT')+renderPendingOrder(pending.sell_limit,'SELL LIMIT')+'</div><p class="muted text-[10px] mt-2">'+escapeHtml(pending.no_trade_reason||'Jika syarat tidak terpenuhi, tetap WAIT.')+'</p>';
resultBox.appendChild(orderPanel);
"""
needle='const putSummary=(id,value)=>'
if needle not in html: raise SystemExit("Analysis result render anchor missing")
if "PENDING ORDER INTELLIGENCE" not in html:
    html=html.replace(needle,pending_ui+"\n   "+needle,1)
p.write_text(html, encoding="utf-8")
print("RitelAI live quote monitor and pending-order display patch applied.")


# Enterprise MT5 trading modes: customer-facing package disclosure.
# This is a product UI only. It must never imply that an EA/broker connection
# exists until the separate MT5 bridge and broker-specific demo tests pass.
html = p.read_text(encoding="utf-8")
mt5_nav = '  <button class="navbtn" data-tab="mt5-trading" onclick="showTab(\'mt5-trading\',this)"><i class="fa-solid fa-robot mr-1"></i>MT5 Trading</button>'
settings_nav_anchor = '  <button class="navbtn" data-tab="settings" onclick="showTab(\'settings\',this)"><i class="fa-solid fa-gear mr-1"></i>Pengaturan</button>'
if 'data-tab="mt5-trading"' not in html:
    if settings_nav_anchor not in html:
        raise SystemExit("Settings navigation anchor not found; cannot safely add MT5 panel")
    html = html.replace(settings_nav_anchor, mt5_nav + "\\n" + settings_nav_anchor, 1)

mt5_panel = '''
 <section id="tab-mt5-trading" class="panel">
  <div class="glass rounded-2xl p-5 mb-4 border border-violet-700/50">
   <div class="flex flex-wrap items-center justify-between gap-2"><span class="text-[10px] tracking-widest text-violet-300 font-bold">ENTERPRISE EXCLUSIVE</span><span class="pill text-amber-200">Integrasi MT5 belum aktif</span></div>
   <h2 class="text-2xl font-extrabold mt-2">MT5 Trading Modes</h2>
   <p class="muted text-xs mt-2">Pilih cara menjalankan strategi. Koneksi Expert Advisor (EA), backend eksekusi, dan pengujian broker demo harus diselesaikan sebelum order dapat dikirim.</p>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
   <article class="glass rounded-xl p-4 border border-slate-700"><span class="pill text-cyan-200">Manual</span><h3 class="font-bold mt-3">Manual Trading</h3><p class="muted text-xs mt-2">RitelAI memberi BUY/SELL/WAIT, alasan teknikal, zona entry, SL, TP, Risk:Reward, dan invalidasi. Customer memasukkan order sendiri di MT5.</p><p class="text-[10px] text-emerald-300 mt-3">Tersedia sebagai alur rekomendasi analisis</p></article>
   <article class="glass rounded-xl p-4 border border-cyan-800"><span class="pill text-cyan-200">Semi-Auto</span><h3 class="font-bold mt-3">Approval sebelum order</h3><p class="muted text-xs mt-2">EA menerima setup, memeriksa simbol dan risiko, lalu meminta persetujuan customer sebelum mengirim order ke MT5.</p><p class="text-[10px] text-amber-200 mt-3">Direncanakan · EA dan konektor belum terpasang</p></article>
   <article class="glass rounded-xl p-4 border border-violet-700"><span class="pill text-violet-200">Auto</span><h3 class="font-bold mt-3">Automated Trading</h3><p class="muted text-xs mt-2">EA menjalankan setup yang lolos filter, dengan batas risiko per transaksi, batas rugi harian, proteksi spread, dan emergency stop.</p><p class="text-[10px] text-amber-200 mt-3">Direncanakan · nonaktif sampai lulus demo test</p></article>
  </div>
  <div class="glass rounded-xl p-4 mt-4">
   <h3 class="font-bold text-sm">Standar sinyal dan eksekusi</h3>
   <ul class="muted text-xs list-disc pl-5 mt-2 space-y-1">
    <li>Setiap sinyal wajib memuat alasan BUY/SELL/WAIT dan bukti indikator yang benar-benar tersedia.</li>
    <li>SL wajib; TP1/TP2, Risk:Reward, zona entry, dan alasan invalidasi ditampilkan sebelum order.</li>
    <li>Setup yang tidak jelas, harga stale, spread berlebihan, atau koneksi terputus harus ditolak.</li>
    <li>Skor confidence bukan win rate. Akurasi historis hanya ditampilkan setelah backtest dan forward test tercatat.</li>
    <li>Auto mode memiliki batas risiko, batas kerugian harian, tombol stop, dan emergency close.</li>
   </ul>
  </div>
  <div class="glass rounded-xl p-4 mt-4">
   <div class="flex items-center justify-between gap-2"><b class="text-sm">Status koneksi akun demo</b><span class="pill text-amber-200">Belum terhubung</span></div>
   <p class="muted text-xs mt-2">Belum ada order yang dikirim ke MT5 dari halaman ini. Hubungkan EA resmi dan selesaikan uji akun demo broker sebelum mengaktifkan Semi-Auto atau Auto.</p>
   <p class="muted text-[10px] mt-2">Jangan masukkan password MT5 ke website. Koneksi harus menggunakan EA dan token koneksi yang dapat dicabut.</p>
  </div>
 </section>
'''
if 'id="tab-mt5-trading"' not in html:
    anchor = ' <section id="tab-settings" class="panel">'
    if anchor not in html:
        raise SystemExit("Settings panel anchor not found; cannot safely add MT5 panel")
    html = html.replace(anchor, mt5_panel + "\\n" + anchor, 1)

# Advertise the three modes only in the highest tier if a plan/pricing area exists.
# Do not fabricate prices, entitlements, or payment behavior.
enterprise_copy = '<div class="mt-3 text-[11px] text-violet-200">Eksklusif Enterprise: Manual · Semi-Auto MT5 · Auto MT5 (setelah integrasi dan uji demo)</div>'
if 'Eksklusif Enterprise: Manual' not in html:
    candidates = ['>Enterprise</', '>ENTERPRISE</', 'Enterprise Plan']
    for marker in candidates:
        pos = html.find(marker)
        if pos >= 0:
            end = html.find('</', pos)
            if end >= 0:
                close = html.find('>', end) + 1
                html = html[:close] + enterprise_copy + html[close:]
                break

p.write_text(html, encoding="utf-8")
print("RitelAI Enterprise MT5 modes panel applied; execution remains explicitly disabled until EA bridge is installed and demo-tested.")


// RitelAI MT5 pairing UI. This creates a one-time DEMO pairing code via the
// authenticated Edge Function; it does not create orders or enable trading.
html = p.read_text(encoding="utf-8")
pairing_card = '''
  <div class="glass rounded-xl p-4 mt-4 border border-cyan-800/60">
   <div class="flex items-center justify-between gap-2"><b class="text-sm">Hubungkan terminal MT5 demo</b><span class="pill text-violet-200">Khusus paket Enterprise</span></div>
   <p class="muted text-xs mt-2">Fitur eksklusif pelanggan Enterprise aktif. Paket di bawah Enterprise akan terkunci dan tidak dapat membuat pairing MT5. Pairing hanya untuk akun demo; jangan pernah memasukkan password broker di sini.</p>
   <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
    <div><label class="muted text-[11px] block mb-1">Broker</label><select id="ritelMt5Broker" class="field" onchange="updateRitelMt5Profile()"><option value="EXNESS">Exness</option><option value="VERSUS_TRADE">Versus Trade</option></select></div>
    <div><label class="muted text-[11px] block mb-1">Jenis akun demo</label><select id="ritelMt5Profile" class="field"><option value="STANDARD_CENT">Standard Cent</option></select></div>
   </div>
   <button id="ritelMt5PairButton" class="btn primary mt-3" onclick="createRitelMt5PairingCode()">Buat kode pairing</button>
   <div id="ritelMt5PairResult" class="mt-3" aria-live="polite"><p class="muted text-[10px]">Akses Enterprise diperlukan. Kode berlaku 10 menit dan hanya dapat digunakan sekali.</p></div>
  </div>
'''
if 'id="ritelMt5PairButton"' not in html:
    marker = '  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">'
    if marker not in html:
        raise SystemExit("MT5 mode cards anchor not found; refusing to inject pairing UI")
    html = html.replace(marker, pairing_card + "\n" + marker, 1)

pairing_js = r"""
function updateRitelMt5Profile(){
 const broker=document.getElementById('ritelMt5Broker')?.value,profile=document.getElementById('ritelMt5Profile');
 if(!profile)return;
 profile.innerHTML=broker==='EXNESS'?'<option value="STANDARD_CENT">Standard Cent</option>':'<option value="STANDARD">Standard</option>';
}
async function createRitelMt5PairingCode(){
 const button=document.getElementById('ritelMt5PairButton'),out=document.getElementById('ritelMt5PairResult');
 if(!button||!out)return;
 button.disabled=true;button.textContent='Membuat kode...';out.textContent='Memeriksa sesi dan hak paket Enterprise...';
 try{
  const {data:sessionData,error:sessionError}=await supabaseClient.auth.getSession();
  if(sessionError)throw sessionError;
  if(!sessionData?.session?.access_token)throw new Error('Silakan login terlebih dahulu ke akun RitelAI.');
  const broker=document.getElementById('ritelMt5Broker').value;
  const account_profile=document.getElementById('ritelMt5Profile').value;
  const {data,error}=await supabaseClient.functions.invoke('mt5-bridge',{body:{action:'create_pairing_code',broker,account_profile}});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  if(!data?.pairing_code)throw new Error('Kode pairing tidak diterima dari server.');
  const code=String(data.pairing_code);
  out.innerHTML='<div class="rounded-xl border border-emerald-800 bg-slate-950 p-3"><div class="text-[10px] text-emerald-300 font-bold tracking-widest">KODE PAIRING DEMO · SEKALI PAKAI</div><div id="ritelMt5PairCode" class="text-2xl font-extrabold tracking-[.18em] mt-2">'+escapeHtml(code)+'</div><button class="btn border border-slate-600 mt-2" onclick="navigator.clipboard?.writeText(document.getElementById(\'ritelMt5PairCode\')?.textContent||\'\')">Salin kode</button><p class="muted text-[10px] mt-2">Berlaku '+Math.floor(Number(data.expires_in_seconds||600)/60)+' menit. Masukkan ke input Pairing Code pada EA MT5 DEMO. Jangan kirim kode ini kepada orang lain.</p></div>';
 }catch(e){
  out.innerHTML='<p class="text-xs text-amber-200">'+escapeHtml(e.message||'Gagal membuat kode pairing.')+'</p>';
 }finally{button.disabled=false;button.textContent='Buat kode pairing';}
}
"""
if 'function createRitelMt5PairingCode()' not in html:
    pos=html.rfind("</script>")
    if pos<0: raise SystemExit("No script block found for pairing UI functions")
    html=html[:pos]+pairing_js+"\n"+html[pos:]
p.write_text(html,encoding="utf-8")
print("RitelAI MT5 pairing-code UI patch applied.")
