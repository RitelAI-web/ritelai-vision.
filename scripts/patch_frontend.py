from pathlib import Path
import re

p = Path("site/index.html")
html = p.read_text(encoding="utf-8")

old = '<select id="asset" class="field mb-3"><option>XAUUSD — Gold</option><option>BTCUSD — Bitcoin</option><option>EURUSD — Euro / US Dollar</option><option>GBPUSD — Pound / US Dollar</option><option>USDJPY — US Dollar / Yen</option><option>US30 — Dow Jones</option></select>'
options = {
"CRYPTO": [("BTCUSD","Bitcoin / USD"),("ETHUSD","Ethereum / USD"),("SOLUSD","Solana / USD"),("BNBUSD","BNB / USD"),("XRPUSD","XRP / USD"),("ADAUSD","Cardano / USD"),("DOGEUSD","Dogecoin / USD"),("AVAXUSD","Avalanche / USD"),("LINKUSD","Chainlink / USD"),("LTCUSD","Litecoin / USD")],
"FOREX": [("EURUSD","Euro / US Dollar"),("GBPUSD","Pound / US Dollar"),("USDJPY","US Dollar / Yen"),("AUDUSD","Australian Dollar / US Dollar"),("USDCAD","US Dollar / Canadian Dollar"),("USDCHF","US Dollar / Swiss Franc"),("NZDUSD","New Zealand Dollar / US Dollar"),("EURJPY","Euro / Yen"),("GBPJPY","Pound / Yen"),("EURGBP","Euro / Pound"),("USDCNH","US Dollar / Offshore Yuan")],
"COMMODITIES": [("XAUUSD","Gold / USD"),("XAGUSD","Silver / USD"),("WTIUSD","WTI Crude Oil"),("BRENT","Brent Crude Oil"),("NATGAS","Natural Gas"),("COPPER","Copper")],
"INDICES": [("US30","Dow Jones"),("US500","S&P 500"),("NAS100","Nasdaq 100"),("US2000","Russell 2000"),("GER40","DAX 40"),("UK100","FTSE 100"),("FRA40","CAC 40"),("JP225","Nikkei 225"),("HK50","Hang Seng"),("AUS200","ASX 200")],
"SHARES": [("AAPL","Apple"),("MSFT","Microsoft"),("NVDA","NVIDIA"),("AMZN","Amazon"),("GOOGL","Alphabet"),("META","Meta Platforms"),("TSLA","Tesla"),("BRK.B","Berkshire Hathaway"),("JPM","JPMorgan Chase"),("NFLX","Netflix")]
}
parts = ['<select id="asset" class="field mb-3">']
for group, items in options.items():
    parts.append(f'<optgroup label="{group}">')
    for symbol, label in items:
        parts.append(f'<option value="{symbol}"'+(' selected' if symbol=='XAUUSD' else '')+f'>{symbol} — {label}</option>')
    parts.append('</optgroup>')
parts.append('</select>')
new = ''.join(parts)
if old in html:
    html = html.replace(old, new, 1)
elif 'id="asset"' not in html:
    raise SystemExit("Asset selector not found")
elif 'optgroup label="CRYPTO"' not in html:
    raise SystemExit("Asset selector changed unexpectedly; refusing blind replacement")


news_anchor = '<div id="marketWarnings" class="hidden rounded-lg border border-amber-800/60 bg-amber-950/20 text-amber-200 p-3 mt-3 text-[11px] leading-5"></div>'
news_ui = news_anchor + '''
   <div class="border-t border-slate-800 mt-5 pt-4">
    <div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-bold text-sm">Berita Pasar Global</h3><p class="muted text-[10px] mt-1">Crypto, Forex, Komoditas, Saham, Indeks, dan makroekonomi · RSS agregasi Google News</p></div><span id="newsStatus" class="pill">Memuat berita...</span></div>
    <div id="marketNewsItems" class="grid md:grid-cols-2 gap-2 mt-3"><p class="muted text-xs">Mengambil berita terbaru...</p></div>
   </div>'''
if news_anchor in html and 'id="marketNewsItems"' not in html:
    html = html.replace(news_anchor, news_ui, 1)

js_anchor = 'async function loadMarketIntelligence(options={})'
news_js = r"""
async function loadMarketNews(){
 const box=document.getElementById('marketNewsItems'),status=document.getElementById('newsStatus');
 if(!box)return;
 if(status)status.textContent='Memperbarui...';
 try{
  const {data,error}=await supabaseClient.functions.invoke('quick-service',{body:{action:'market_news'}});
  if(error)throw error;
  if(!data||data.status!=='ok')throw new Error(data?.error||'Feed berita tidak tersedia.');
  const items=Array.isArray(data.items)?data.items:[];
  if(status)status.textContent=items.length+' berita · '+(data.source||'RSS');
  box.innerHTML=items.length?items.map(item=>{
   const url=String(item.url||'');const safeUrl=/^https?:\/\//i.test(url)?url:'#';
   const when=item.publishedAt?new Date(item.publishedAt).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}):'Waktu tidak tersedia';
   return '<article class="bg-slate-950/60 border border-slate-800 rounded-xl p-3"><div class="flex gap-2 items-center justify-between"><span class="pill">'+escapeHtml(item.category||'Market')+'</span><span class="muted text-[9px]">'+escapeHtml(when)+'</span></div><a class="block font-semibold text-xs mt-2 text-cyan-200 hover:underline" href="'+escapeHtml(safeUrl)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(item.title||'Berita')+'</a><div class="muted text-[10px] mt-2">'+escapeHtml(item.source||'Sumber tidak tersedia')+'</div></article>';
  }).join(''):'<p class="muted text-xs">Belum ada berita dari feed. Coba perbarui kembali.</p>';
  if(data.errors?.length&&status)status.textContent=items.length+' berita · sebagian sumber gagal';
 }catch(e){if(status)status.textContent='Feed berita bermasalah';box.innerHTML='<p class="text-amber-200 text-xs">'+escapeHtml(e.message||'Berita belum tersedia.')+'</p>';}
}
"""
if js_anchor in html and 'async function loadMarketNews()' not in html:
    html = html.replace(js_anchor, news_js + '\n' + js_anchor, 1)
call_anchor = "const {data,error}=await supabaseClient.functions.invoke('quick-service',{body:{action:'market_calendar',assets:RITELAI_SYMBOLS}});"
if call_anchor in html:
    # Load RSS independently before requesting calendar data. A calendar Edge
    # Function failure must not prevent the separate news feed from rendering.
    html = html.replace(call_anchor, 'await loadMarketNews();\n' + call_anchor, 1)

notice = '<p class="text-[10px] muted leading-relaxed mt-3"><i class="fa-solid fa-circle-info text-cyan-300 mr-1"></i>Analisis dikirim ke Edge Function yang aman. Hasil gambar bukan data harga live dan bukan jaminan profit.</p>'
replacement = '<p class="text-[10px] muted leading-relaxed mt-3"><i class="fa-solid fa-circle-info text-cyan-300 mr-1"></i>Analisis chart tersedia untuk Crypto, Forex, Komoditas, Indeks, dan Saham berdasarkan gambar yang kamu unggah. Ketersediaan harga live dan berita tiap instrumen bergantung pada sumber data terhubung. Hasil bukan jaminan profit.</p>'
if notice in html:
    html = html.replace(notice, replacement, 1)


# Add conditional BUY/SELL scenarios when the chart signal is WAIT.
scenario_anchor = "   const tone=signal==='BUY'?'text-emerald-300':signal==='SELL'?'text-rose-300':'text-amber-300';"
scenario_code = r'''
   const scenarioCard=(label,scenario)=>{if(!scenario)return '';const val=v=>(v===null||v===undefined||v===''?'Belum terbaca dari chart':escapeHtml(String(v)));return '<div class="bg-slate-900 rounded-lg p-3"><b class="text-xs">'+label+'</b><div class="mt-2 text-[11px]"><span class="muted">Pemicu:</span> '+val(scenario.trigger)+'</div><div class="mt-1 text-[11px]"><span class="muted">Konfirmasi:</span> '+val(scenario.confirmation)+'</div><div class="mt-1 text-[11px]"><span class="muted">Pembatalan:</span> '+val(scenario.invalidation)+'</div><div class="mt-1 text-[11px]">'+val(scenario.rationale)+'</div></div>';};
'''
if scenario_anchor in html and 'const scenarioCard=' not in html:
    html = html.replace(scenario_anchor, scenario_anchor + '\n' + scenario_code, 1)
summary_anchor = '<p class="text-sm mt-3">${safe(r.summary)}</p>'
confidence_panel = r'''
    ${'<div class="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-left"><div class="flex items-center justify-between gap-3"><span class="text-xs font-semibold">TINGKAT KEYAKINAN ANALISIS</span><strong class="text-lg text-cyan-300">'+(Number.isFinite(Number(r.confidence))?Math.max(0,Math.min(100,Math.round(Number(r.confidence))))+'%':'Belum tersedia')+'</strong></div><div class="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden"><div class="h-full rounded-full bg-cyan-400" style="width:'+(Number.isFinite(Number(r.confidence))?Math.max(0,Math.min(100,Math.round(Number(r.confidence)))):0)+'%"></div></div><p class="muted text-[10px] mt-2">Mengukur kejelasan bukti pada chart, bukan probabilitas profit atau win rate.</p></div>'}
'''
if summary_anchor in html and 'TINGKAT KEYAKINAN ANALISIS' not in html:
    html = html.replace(summary_anchor, summary_anchor + '\\n' + confidence_panel, 1)
scenario_panel = '''
    ${signal==='WAIT'?'<div class="mt-4 text-left rounded-xl border border-slate-700 bg-slate-950/60 p-4"><div class="font-bold text-xs mb-3">RENCANA BERSYARAT — TUNGGU KONFIRMASI</div><div class="grid gap-2 sm:grid-cols-2">'+scenarioCard('SKENARIO BUY',r.scenario_buy)+scenarioCard('SKENARIO SELL',r.scenario_sell)+'</div><p class="muted text-[10px] mt-3">Pemicu bukan instruksi entry langsung. Tunggu konfirmasi candle dan pastikan level masih berlaku.</p></div>':''}
'''
if summary_anchor in html and 'RENCANA BERSYARAT — TUNGGU KONFIRMASI' not in html:
    html = html.replace(summary_anchor, summary_anchor + '\n' + scenario_panel, 1)


# Require an authenticated customer account before the workspace can be used.
# The existing Supabase sign-up/sign-in form remains the only entry point.

# Customer settings: profile metadata and Supabase Auth security settings.
customer_settings = r"""
<div id="customerSettings" class="hidden mt-4 border-t border-slate-700 pt-4 space-y-3">
 <div class="font-bold text-sm">Pengaturan akun</div>
 <label class="block text-[11px] muted">Nama tampilan</label>
 <input id="customerDisplayName" class="field" maxlength="80" placeholder="Nama kamu">
 <label class="block text-[11px] muted">URL foto profil (opsional)</label>
 <input id="customerAvatarUrl" class="field" type="url" placeholder="https://...">
 <button class="btn primary w-full" onclick="saveCustomerProfile()">Simpan profil</button>
 <div class="border-t border-slate-700 pt-3">
  <div class="font-semibold text-xs mb-2">Keamanan akun</div>
  <label class="block text-[11px] muted">Password baru (minimal 8 karakter)</label>
  <input id="customerNewPassword" class="field" type="password" minlength="8" autocomplete="new-password" placeholder="Password baru">
  <button class="btn border border-slate-700 w-full mt-2" onclick="changeCustomerPassword()">Ubah password</button>
  <label class="block text-[11px] muted mt-3">Email baru</label>
  <input id="customerNewEmail" class="field" type="email" autocomplete="email" placeholder="email-baru@contoh.com">
  <button class="btn border border-slate-700 w-full mt-2" onclick="changeCustomerEmail()">Ubah email</button>
  <p class="muted text-[10px] mt-2">Perubahan email mungkin memerlukan konfirmasi melalui email dari Supabase.</p>
 </div>
 <div class="border-t border-slate-700 pt-3">
  <div class="font-semibold text-xs">Paket & pembayaran</div>
  <p class="muted text-[11px] mt-1">Lihat paket dan alur pembayaran yang tersedia.</p>
  <button class="btn border border-slate-700 w-full mt-2" onclick="openModal('plansModal')">Paket & langganan</button>
 </div>
 <div class="border-t border-slate-700 pt-3">
  <div class="font-semibold text-xs">Bantuan</div>
  <a class="text-cyan-300 text-xs" href="mailto:adilesmana1207@gmail.com">Hubungi bantuan RitelAI</a>
 </div>
 <p id="customerSettingsStatus" class="muted text-[11px]" role="status"></p>
</div>
<button id="customerSettingsToggle" class="btn border border-slate-700 w-full mt-3" onclick="toggleCustomerSettings()">Pengaturan akun</button>
""";
signed_in_anchor = '<div id="signedInRole" class="text-xs cyan mt-1">Customer</div>'
if 'id="customerSettingsToggle"' not in html:
    html = html.replace(signed_in_anchor, signed_in_anchor + customer_settings, 1)

auth_gate = r"""
<script id="ritelai-beta-auth-gate">
(function(){
 const originalRefreshAuth=refreshAuth;
 refreshAuth=async function(){
  await originalRefreshAuth();
  const modal=document.getElementById('accountModal');
  if(!modal)return;
  if(currentUser){
   modal.classList.add('hidden');modal.classList.remove('flex');
   const message=document.getElementById('authMessage');
   if(message&&message.textContent.includes('Akses Beta memerlukan akun'))message.textContent='';
  } else {modal.classList.remove('hidden');modal.classList.add('flex');}
 };
 const originalCloseModal=closeModal;
 closeModal=function(id){
  if(id==='accountModal'&&!currentUser){
   authMessage('Silakan masuk atau daftar untuk mengakses RitelAI Vision Beta.',true);return;
  }
  return originalCloseModal(id);
 };
 const originalShowTab=showTab;
 showTab=function(name,btn){
  if(!currentUser){openModal('accountModal');authMessage('Login atau daftar terlebih dahulu untuk menggunakan fitur Beta.',true);return;}
  return originalShowTab(name,btn);
 };
 const originalSignOut=signOut;
 signOut=async function(){await originalSignOut();openModal('accountModal');authMessage('Sesi berakhir. Masuk kembali untuk mengakses Beta.');};
 window.toggleCustomerSettings=function(){
  const panel=document.getElementById('customerSettings');
  if(!panel)return;
  const opening=panel.classList.contains('hidden');panel.classList.toggle('hidden');
  if(opening&&currentUser){
   const meta=currentUser.user_metadata||{};
   document.getElementById('customerDisplayName').value=meta.full_name||meta.name||'';
   document.getElementById('customerAvatarUrl').value=meta.avatar_url||'';
  }
 };
 window.saveCustomerProfile=async function(){
  const status=document.getElementById('customerSettingsStatus');
  if(!currentUser||!supabaseClient){status.textContent='Sesi login tidak tersedia.';return;}
  const full_name=document.getElementById('customerDisplayName').value.trim();
  const avatar_url=document.getElementById('customerAvatarUrl').value.trim();
  if(avatar_url&&!/^https:\/\/.+/i.test(avatar_url)){status.textContent='URL foto harus diawali https://';return;}
  status.textContent='Menyimpan profil...';
  const {data,error}=await supabaseClient.auth.updateUser({data:{full_name,avatar_url}});
  if(error){status.textContent='Gagal menyimpan: '+error.message;return;}
  currentUser=data.user||currentUser;status.textContent='Profil berhasil disimpan.';
 };
 window.changeCustomerPassword=async function(){
  const status=document.getElementById('customerSettingsStatus'),password=document.getElementById('customerNewPassword').value;
  if(!currentUser||!supabaseClient){status.textContent='Sesi login tidak tersedia.';return;}
  if(password.length<8){status.textContent='Password minimal 8 karakter.';return;}
  status.textContent='Memperbarui password...';
  const {error}=await supabaseClient.auth.updateUser({password});
  if(error){status.textContent='Gagal mengubah password: '+error.message;return;}
  document.getElementById('customerNewPassword').value='';status.textContent='Password berhasil diperbarui.';
 };
 window.changeCustomerEmail=async function(){
  const status=document.getElementById('customerSettingsStatus'),email=document.getElementById('customerNewEmail').value.trim();
  if(!currentUser||!supabaseClient){status.textContent='Sesi login tidak tersedia.';return;}
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){status.textContent='Masukkan email yang valid.';return;}
  status.textContent='Mengirim permintaan perubahan email...';
  const {error}=await supabaseClient.auth.updateUser({email});
  if(error){status.textContent='Gagal mengubah email: '+error.message;return;}
  status.textContent='Permintaan perubahan email dikirim. Periksa email untuk konfirmasi.';
 };
 document.addEventListener('DOMContentLoaded',function(){refreshAuth().catch(function(){ });});
})();
</script>
"""
if 'id="ritelai-beta-auth-gate"' not in html:
    html = html.replace('</body>', auth_gate + '\\n</body>', 1)


# GitHub Pages project sites live under a repository path. Using location.origin
# sends Supabase email confirmation to the domain root (a 404); use the full app URL.
html = html.replace(
    "emailRedirectTo:location.origin",
    "emailRedirectTo:'https://adilesmana1207-cyber.github.io/ritelai-vision./'"
)
html = html.replace(
    "redirectTo:location.origin",
    "redirectTo:'https://adilesmana1207-cyber.github.io/ritelai-vision./'"
)

p.write_text(html, encoding="utf-8")
print("Patched universal instrument selector:", sum(map(len, options.values())), "instruments")
