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
