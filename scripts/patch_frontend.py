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

notice = '<p class="text-[10px] muted leading-relaxed mt-3"><i class="fa-solid fa-circle-info text-cyan-300 mr-1"></i>Analisis dikirim ke Edge Function yang aman. Hasil gambar bukan data harga live dan bukan jaminan profit.</p>'
replacement = '<p class="text-[10px] muted leading-relaxed mt-3"><i class="fa-solid fa-circle-info text-cyan-300 mr-1"></i>Analisis chart tersedia untuk Crypto, Forex, Komoditas, Indeks, dan Saham berdasarkan gambar yang kamu unggah. Ketersediaan harga live dan berita tiap instrumen bergantung pada sumber data terhubung. Hasil bukan jaminan profit.</p>'
if notice in html:
    html = html.replace(notice, replacement, 1)

p.write_text(html, encoding="utf-8")
print("Patched universal instrument selector:", sum(map(len, options.values())), "instruments")
