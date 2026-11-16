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

settings_panel = '''
 <section id="tab-settings" class="panel">
  <div class="mb-4"><div class="text-[10px] tracking-widest text-cyan-300 font-bold">PREFERENSI APLIKASI</div><h2 class="text-xl font-extrabold">Pengaturan</h2><p class="muted text-xs mt-1">Atur preferensi analisis dan tampilan. Pengaturan tersimpan pada browser/perangkat ini.</p></div>
  <div class="grid lg:grid-cols-2 gap-4">
   <div class="glass rounded-2xl p-4">
    <h3 class="font-bold text-sm mb-3">Default analisis</h3>
    <label class="text-[11px] muted block mb-1">Timeframe pilihan</label>
    <select id="prefTimeframe" class="field mb-3"><option>M5</option><option>M15</option><option>M30</option><option>H1</option><option>H4</option><option>D1</option></select>
    <label class="text-[11px] muted block mb-1">Modal akun default (USD)</label><input id="prefBalance" type="number" min="0" class="field mb-3" value="1000">
    <label class="text-[11px] muted block mb-1">Risiko default per transaksi (%)</label><input id="prefRisk" type="number" min="0.1" max="2" step="0.1" class="field mb-3" value="1">
    <div class="flex gap-2 flex-wrap"><button class="btn primary" onclick="saveRitelSettings()">Simpan pengaturan</button><button class="btn border border-slate-600" onclick="resetRitelSettings()">Pulihkan default</button></div>
    <p id="settingsSaveNote" class="muted text-[10px] mt-3">Belum ada perubahan tersimpan.</p>
   </div>
   <div class="glass rounded-2xl p-4">
    <h3 class="font-bold text-sm mb-2">Checklist indikator pilihan</h3>
    <p class="muted text-[10px] mb-3">Checklist ini menyimpan preferensi pribadi. Belum mengaktifkan/menonaktifkan perhitungan indikator pada server AI.</p>
    <div class="grid grid-cols-2 gap-3 text-xs">
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="EMA 9/20/50/200"> EMA 9/20/50/200</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="Parabolic SAR"> Parabolic SAR</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="RSI 14"> RSI 14</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="MACD"> MACD</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="ADX/DMI"> ADX/DMI</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="Bollinger Bands"> Bollinger Bands</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="VWAP"> VWAP</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="Stochastic RSI"> Stochastic RSI</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="ATR"> ATR</label>
     <label class="flex gap-2 items-center"><input type="checkbox" class="pref-indicator" value="Volume"> Volume</label>
    </div>
   </div>
   <div class="glass rounded-2xl p-4 lg:col-span-2">
    <h3 class="font-bold text-sm mb-2">Administrasi & layanan</h3>
    <p class="muted text-xs">Pengelolaan pengguna, paket, pembayaran manual, dan pengumuman tersedia di Dashboard Admin setelah masuk dengan akun berizin Owner/Admin.</p>
    <button class="btn border border-cyan-700 text-cyan-200 mt-3" onclick="showAdmin()"><i class="fa-solid fa-user-shield mr-1"></i>Buka Dashboard Admin</button>
    <p class="muted text-[10px] mt-2">Kunci API, role Owner, dan konfigurasi backend tidak disimpan di browser. Perubahan tersebut harus dilakukan melalui Supabase/server dengan hak akses yang sesuai.</p>
   </div>
  </div>
 </section>
'''
if 'id="tab-settings"' not in html:
    admin_anchor = ' <section id="tab-admin" class="panel">'
    if admin_anchor not in html:
        raise SystemExit("Admin panel anchor not found; refusing to inject settings panel")
    html = html.replace(admin_anchor, settings_panel + "\n" + admin_anchor, 1)

settings_js = '''
function readRitelSettings(){
 try{return JSON.parse(localStorage.getItem('ritelai.userSettings')||'{}')}catch(_){return {}}
}
function applyRitelSettings(){
 const s=readRitelSettings();
 const tf=document.getElementById('prefTimeframe'), bal=document.getElementById('prefBalance'), risk=document.getElementById('prefRisk');
 if(tf&&s.timeframe)tf.value=s.timeframe;
 if(bal&&s.balance!=null)bal.value=s.balance;
 if(risk&&s.risk!=null)risk.value=s.risk;
 document.querySelectorAll('.pref-indicator').forEach(x=>x.checked=Array.isArray(s.indicators)?s.indicators.includes(x.value):true);
 const liveTf=document.getElementById('timeframe'), liveBal=document.getElementById('balance'), liveRisk=document.getElementById('risk');
 if(liveTf&&s.timeframe)liveTf.value=s.timeframe;
 if(liveBal&&s.balance!=null)liveBal.value=s.balance;
 if(liveRisk&&s.risk!=null)liveRisk.value=s.risk;
}
function saveRitelSettings(){
 const s={timeframe:document.getElementById('prefTimeframe').value,balance:Math.max(0,Number(document.getElementById('prefBalance').value)||0),risk:Math.min(2,Math.max(.1,Number(document.getElementById('prefRisk').value)||1)),indicators:[...document.querySelectorAll('.pref-indicator:checked')].map(x=>x.value)};
 try{localStorage.setItem('ritelai.userSettings',JSON.stringify(s));applyRitelSettings();document.getElementById('settingsSaveNote').textContent='Tersimpan pada perangkat ini. Preferensi default analisis telah diterapkan.';toast('Pengaturan berhasil disimpan.')}catch(e){toast('Tidak dapat menyimpan pengaturan pada browser ini.')}
}
function resetRitelSettings(){
 try{localStorage.removeItem('ritelai.userSettings')}catch(_){}
 const tf=document.getElementById('prefTimeframe'),bal=document.getElementById('prefBalance'),risk=document.getElementById('prefRisk');
 if(tf)tf.value='M15';if(bal)bal.value='1000';if(risk)risk.value='1';
 document.querySelectorAll('.pref-indicator').forEach(x=>x.checked=true);
 const liveTf=document.getElementById('timeframe'),liveBal=document.getElementById('balance'),liveRisk=document.getElementById('risk');
 if(liveTf)liveTf.value='M15';if(liveBal)liveBal.value='1000';if(liveRisk)liveRisk.value='1';
 document.getElementById('settingsSaveNote').textContent='Default awal dipulihkan.';toast('Pengaturan dipulihkan ke default.');
}
'''
if 'function saveRitelSettings()' not in html:
    js_anchor = 'function showTab(name,btn)'
    if js_anchor not in html:
        raise SystemExit("Tab controller not found; refusing to inject settings behavior")
    html = html.replace(js_anchor, settings_js + "\n" + js_anchor, 1)

# Apply saved defaults after the page DOM exists.
if "applyRitelSettings();" not in html[html.rfind("window.addEventListener('DOMContentLoaded'"):]:
    html = html.replace("  startMarketAutoRefresh();", "  startMarketAutoRefresh();\n  applyRitelSettings();", 1)


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
