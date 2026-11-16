from pathlib import Path

p = Path("extracted")
files = list(p.rglob("supabase/functions/quick-service/index.ts"))
if not files:
    raise SystemExit("quick-service source missing from package")
f = files[0]
s = f.read_text(encoding="utf-8")
if 'body?.action === "market_news"' in s:
    print("Market news endpoint already present")
    raise SystemExit(0)

helper = r'''
function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16))).trim();
}
function xmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}
async function getMarketNews() {
  const topics = [
    { category: "Global Markets", q: "global financial markets economy central banks" },
    { category: "Crypto", q: "cryptocurrency Bitcoin Ethereum digital assets" },
    { category: "Forex", q: "forex currency markets dollar euro yen" },
    { category: "Commodities", q: "gold silver crude oil commodities" },
    { category: "Stocks & Indices", q: "global stock markets equities indices earnings" },
  ];
  const results = await Promise.allSettled(topics.map(async (topic) => {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", topic.q);
    url.searchParams.set("hl", "en-US"); url.searchParams.set("gl", "US"); url.searchParams.set("ceid", "US:en");
    const response = await fetch(url.toString(), { headers: { "User-Agent": "RitelAI-Vision/1.0", "Accept": "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(topic.category + ": HTTP " + response.status);
    const xml = await response.text();
    return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => {
      const block = match[1], title = xmlTag(block, "title"), link = xmlTag(block, "link"), pubDate = xmlTag(block, "pubDate");
      const timestamp = Date.parse(pubDate);
      return { title, url: link, source: xmlTag(block, "source") || "Google News", publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null, category: topic.category };
    }).filter((item) => item.title && /^https?:\/\//i.test(item.url));
  }));
  const items = results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
  const errors = results.filter((r) => r.status === "rejected").map((r: any) => messageOf(r.reason));
  const unique = new Map<string, AnyRecord>();
  for (const item of items) if (!unique.has(item.url)) unique.set(item.url, item);
  return { items: [...unique.values()].sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || "")).slice(0, 30), errors };
}
'''
marker = "Deno.serve(async (request: Request) => {"
if marker not in s: raise SystemExit("Edge Function handler not found")
s = s.replace(marker, helper + "\n" + marker, 1)
old = '''  if (body?.action !== "market_calendar") {
    return reply({ status: "error", error: "Aksi tidak dikenal. Gunakan action: market_calendar." }, 400);
  }'''
new = '''  if (body?.action === "market_news") {
    try { const news = await getMarketNews(); return reply({ status: "ok", generatedAt: new Date().toISOString(), source: "Google News RSS", ...news }); }
    catch (error) { return reply({ status: "error", error: messageOf(error), items: [] }, 502); }
  }
  if (body?.action !== "market_calendar") {
    return reply({ status: "error", error: "Aksi tidak dikenal. Gunakan action: market_calendar atau market_news." }, 400);
  }'''
if old not in s: raise SystemExit("Action router block not found")
s = s.replace(old, new, 1)
f.write_text(s, encoding="utf-8")
print("Patched quick-service with market_news RSS action")
