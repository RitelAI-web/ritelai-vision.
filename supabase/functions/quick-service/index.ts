// RitelAI Vision — public Market Intelligence Edge Function
// Deploy as the existing Supabase function named: quick-service
// Public read-only endpoint: keep all secrets on the server, never in HTML.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const SYMBOLS = ["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD", "USDJPY", "US30"] as const;
type SymbolKey = typeof SYMBOLS[number];
type AnyRecord = Record<string, any>;

function reply(body: AnyRecord, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Kesalahan tidak diketahui");
}

async function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "RitelAI-Vision/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : null; }
  catch { throw new Error(`Respons bukan JSON dari ${new URL(url).hostname}`); }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${response.status} dari ${new URL(url).hostname}`);
  }
  return data;
}

async function getTick(symbol: SymbolKey) {
  const data = await fetchJson(`https://biquote.io/api/${encodeURIComponent(symbol)}`, 5000);
  // BiQuote documents mid as the correct single price for FX/CFD; last is often 0.
  const candidates = [
    data?.mid,
    data?.price,
    data?.lastPrice,
    data?.last,
    data?.bid != null && data?.ask != null ? (Number(data.bid) + Number(data.ask)) / 2 : null,
    data?.bid,
    data?.ask,
  ];
  const price = candidates.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
  if (price === undefined) throw new Error(`${symbol}: feed tidak mengirim harga valid`);

  const quoteTime = data?.timestamp ?? data?.lastQuoteAt ?? null;
  const ageSeconds = Number(data?.quoteAgeSeconds);
  const marketClosed = String(data?.marketState ?? "").toLowerCase() === "closed";
  const stale = Boolean(data?.stale) || (Number.isFinite(ageSeconds) && ageSeconds > 300);
  return {
    key: symbol,
    symbol,
    label: symbol,
    price,
    last: price, // backward-compatible with existing frontend
    mid: Number(data?.mid) > 0 ? Number(data.mid) : price,
    bid: Number(data?.bid) > 0 ? Number(data.bid) : null,
    ask: Number(data?.ask) > 0 ? Number(data.ask) : null,
    changePct: Number.isFinite(Number(data?.dayDiffPercent)) ? Number(data.dayDiffPercent) : null,
    time: quoteTime,
    timestamp: quoteTime,
    ageMinutes: Number.isFinite(ageSeconds) ? Math.round(ageSeconds / 60) : null,
    source: data?.source ?? "BiQuote MT5",
    marketState: marketClosed ? "closed" : "open",
    stale,
    status: marketClosed ? "MARKET_CLOSED" : stale ? "STALE" : "LIVE_TICK",
  };
}

function eventTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (value == null || value === "") return NaN;
  const raw = String(value).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const number = Number(raw);
    return raw.length <= 10 ? number * 1000 : number;
  }
  return Date.parse(raw);
}

async function getCalendar() {
  const now = Date.now();
  // Sisa November 2026 (mulai saat ini) sampai 31 Desember 2026 23:59:59.999 WIB.
  // Waktu akhir dikonversi ke UTC karena API kalender menerima ISO UTC.
  const start = now;
  const end = Date.UTC(2026, 11, 31, 23, 59, 59, 999) - 7 * 60 * 60 * 1000;
  const url = new URL("https://biquote.io/api/calendar");
  url.searchParams.set("from", new Date(start).toISOString());
  url.searchParams.set("to", new Date(end).toISOString());
  url.searchParams.set("countries", "US,EU,GB,JP,CA,AU,CH,NZ,CN");
  url.searchParams.set("importance", "high");
  url.searchParams.set("limit", "500");
  const rows = await fetchJson(url.toString(), 5000);
  if (!Array.isArray(rows)) throw new Error("Format kalender ekonomi dari penyedia tidak dikenali");

  const relevantEvent = /\b(nfp|non[- ]?farm payrolls?|employment situation|employment change|unemployment rate|retail sales|cpi|consumer price index|core cpi|ppi|producer price index|core ppi|pce|personal consumption expenditures|personal income|fomc|federal reserve|fed funds|federal funds rate|fed interest rate decision|ecb|european central bank|boe|bank of england|boj|bank of japan|bank of canada|reserve bank of australia|swiss national bank|reserve bank of new zealand|people.?s bank of china|interest rate decision|rate decision|policy rate|cash rate|monetary policy|gross domestic product|gdp)\b/i;
  const allowedCurrencies = new Set(["USD", "US", "USA", "EUR", "EU", "GBP", "GB", "UK", "JPY", "JP", "CAD", "CA", "AUD", "AU", "CHF", "CH", "NZD", "NZ", "CNY", "CN"]);
  return rows
    .map((event: AnyRecord) => {
      const rawTime = event?.time ?? event?.timestamp ?? event?.datetime ?? event?.date;
      const timestamp = eventTimestamp(rawTime);
      return { event, timestamp };
    })
    .filter(({ event, timestamp }: { event: AnyRecord; timestamp: number }) => {
      if (!event || !Number.isFinite(timestamp) || timestamp < start || timestamp > end || timestamp <= now) return false;
      const rawImpact = event.importance ?? event.impact ?? event.impactLevel ?? event.impact_level;
      const impact = String(rawImpact ?? "").trim().toLowerCase();
      const highImpact = ["high", "high impact", "3", "3.0", "tinggi", "red"].includes(impact) || Number(rawImpact) === 3;
      if (!highImpact) return false;
      const currency = String(event.currency ?? event.countryCode ?? event.country ?? "").trim().toUpperCase();
      if (currency && !allowedCurrencies.has(currency)) return false;
      return relevantEvent.test(String(event.name ?? event.title ?? event.event ?? ""));
    })
    .map(({ event, timestamp }: { event: AnyRecord; timestamp: number }) => ({
      ...event,
      id: String(event.id ?? event.eventId ?? `${event.name ?? event.title ?? event.event}-${timestamp}`),
      time: new Date(timestamp).toISOString(),
      name: event.name ?? event.title ?? event.event ?? "Rilis ekonomi",
      importance: "high",
      countryCode: event.countryCode ?? event.country ?? "",
      currency: event.currency ?? "",
      actual: event.actual ?? null,
      forecast: event.forecast ?? null,
      previous: event.previous ?? null,
      revisedPrevious: event.revisedPrevious ?? event.revised_previous ?? null,
    }))
    .sort((a: AnyRecord, b: AnyRecord) => Date.parse(a.time) - Date.parse(b.time));
}
function getOfficialScheduledEvents(): AnyRecord[] {
  // Jadwal yang sudah diumumkan oleh BLS, Federal Reserve, dan BEA.
  // Semua waktu disimpan sebagai ISO UTC; kartu frontend mengubahnya ke WIB.
  const rows: AnyRecord[] = [
    { id: "official-fomc-minutes-2026-11-18", name: "Federal Reserve — FOMC Minutes (rapat 27–28 Oktober)", time: "2026-11-18T19:00:00.000Z", currency: "USD", countryCode: "US", source: "Federal Reserve", sourceUrl: "https://www.federalreserve.gov/newsevents/2026-November.htm", scheduleNote: "Jadwal resmi Federal Reserve; rilis 14.00 ET (19 November 02.00 WIB)." },
    { id: "official-gdp-2026-11-25", name: "US GDP q/q — Second Estimate & Corporate Profits Q3 2026", time: "2026-11-25T13:30:00.000Z", currency: "USD", countryCode: "US", source: "Bureau of Economic Analysis", sourceUrl: "https://www.bea.gov/news/schedule/full", scheduleNote: "Jadwal resmi BEA; 08.30 ET (20.30 WIB)." },
    { id: "official-pce-2026-11-25", name: "US Personal Income and Outlays — PCE Inflation (October 2026)", time: "2026-11-25T13:30:00.000Z", currency: "USD", countryCode: "US", source: "Bureau of Economic Analysis", sourceUrl: "https://www.bea.gov/news/schedule/full", scheduleNote: "Jadwal resmi BEA; 08.30 ET (20.30 WIB)." },
    { id: "official-nfp-2026-12-04", name: "US Non-Farm Payrolls (NFP) & Unemployment Rate — November 2026", time: "2026-12-04T13:30:00.000Z", currency: "USD", countryCode: "US", source: "Bureau of Labor Statistics", sourceUrl: "https://www.bls.gov/schedule/2026/12_sched_list.htm", scheduleNote: "Employment Situation; 08.30 ET (20.30 WIB)." },
    { id: "official-fomc-2026-12-09", name: "US Federal Reserve Interest Rate Decision (FOMC) & Economic Projections", time: "2026-12-09T19:00:00.000Z", currency: "USD", countryCode: "US", source: "Federal Reserve", sourceUrl: "https://www.federalreserve.gov/newsevents/2026-december.htm", scheduleNote: "Pernyataan FOMC pukul 14.00 ET (10 Desember 02.00 WIB); konferensi pers 14.30 ET (02.30 WIB)." },
    { id: "official-cpi-2026-12-10", name: "US Consumer Price Index (CPI) & Core CPI — November 2026", time: "2026-12-10T13:30:00.000Z", currency: "USD", countryCode: "US", source: "Bureau of Labor Statistics", sourceUrl: "https://www.bls.gov/schedule/2026/12_sched_list.htm", scheduleNote: "08.30 ET (20.30 WIB)." },
    { id: "official-ppi-2026-12-15", name: "US Producer Price Index (PPI) & Core PPI — November 2026", time: "2026-12-15T13:30:00.000Z", currency: "USD", countryCode: "US", source: "Bureau of Labor Statistics", sourceUrl: "https://www.bls.gov/schedule/2026/12_sched_list.htm", scheduleNote: "08.30 ET (20.30 WIB)." },
    { id: "official-gdp-2026-12-23", name: "US GDP q/q — Third Estimate Q3 2026", time: "2026-12-23T13:30:00.000Z", currency: "USD", countryCode: "US", source: "Bureau of Economic Analysis", sourceUrl: "https://www.bea.gov/news/schedule/full", scheduleNote: "08.30 ET (20.30 WIB)." },
    { id: "official-pce-2026-12-23", name: "US Personal Income and Outlays — PCE Inflation (November 2026)", time: "2026-12-23T13:30:00.000Z", currency: "USD", countryCode: "US", source: "Bureau of Economic Analysis", sourceUrl: "https://www.bea.gov/news/schedule/full", scheduleNote: "08.30 ET (20.30 WIB)." },
    { id: "official-fomc-minutes-2026-12-30", name: "Federal Reserve — FOMC Minutes (rapat 8–9 Desember)", time: "2026-12-30T19:00:00.000Z", currency: "USD", countryCode: "US", source: "Federal Reserve", sourceUrl: "https://www.federalreserve.gov/newsevents/2026-december.htm", scheduleNote: "Jadwal resmi Federal Reserve; rilis 14.00 ET (31 Desember 02.00 WIB)." },
  ];
  const now = Date.now();
  const end = Date.UTC(2026, 11, 31, 23, 59, 59, 999) - 7 * 60 * 60 * 1000;
  return rows.filter((event) => Date.parse(event.time) > now && Date.parse(event.time) <= end).map((event) => ({
    ...event, importance: "high", timeMode: "exact", scheduleStatus: "official_scheduled",
    actual: null, forecast: null, previous: null, revisedPrevious: null,
  }));
}

function mergeCalendarEvents(providerEvents: AnyRecord[], officialEvents: AnyRecord[]): AnyRecord[] {
  const merged = new Map<string, AnyRecord>();
  for (const event of [...providerEvents, ...officialEvents]) {
    const key = `${String(event.name ?? event.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${Date.parse(event.time)}`;
    // Jadwal resmi menjadi sumber utama untuk rilis yang tanggalnya sudah dikonfirmasi.
    if (!merged.has(key) || event.scheduleStatus === "official_scheduled") merged.set(key, event);
  }
  return [...merged.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function extractResponseText(data: AnyRecord): string {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output ?? [])
    .flatMap((item: AnyRecord) => item?.content ?? [])
    .filter((part: AnyRecord) => part?.type === "output_text" && typeof part?.text === "string")
    .map((part: AnyRecord) => part.text)
    .join("\n");
}

function parseJsonText(raw: string): AnyRecord {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Respons AI tidak berisi JSON yang valid");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function macroSeriesForEvent(event: AnyRecord): string[] {
  const name = String(event.name || '').toLowerCase();
  if (/nfp|non.?farm|employment situation|payroll|unemployment/.test(name)) return ['PAYEMS', 'UNRATE'];
  if (/consumer price|\\bcpi\\b/.test(name)) return ['CPIAUCSL', 'CPILFESL'];
  if (/producer price|\\bppi\\b/.test(name)) return ['PPIACO', 'PPIFIS'];
  if (/pce|personal consumption/.test(name)) return ['PCEPI', 'PCEPILFE'];
  if (/fomc|federal reserve|fed funds|interest rate decision|policy rate/.test(name)) return ['FEDFUNDS', 'DGS10'];
  if (/retail sales/.test(name)) return ['RSAFS'];
  if (/gdp|gross domestic/.test(name)) return ['GDP'];
  return [];
}
async function fetchFredHistory(seriesId: string): Promise<AnyRecord> {
  const response = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + encodeURIComponent(seriesId), { headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('FRED HTTP ' + response.status);
  const csv = await response.text();
  const rows = csv.trim().split(/\\r?\\n/).slice(1).filter((line) => line && !line.endsWith(',.'));
  const observations = rows.slice(-8).map((line) => { const cells = line.split(','); return { date: cells[0], value: cells.slice(1).join(',') }; }).filter((row) => row.value && row.value !== '.');
  return { series: seriesId, observations };
}
async function getHistoricalMacroContext(event: AnyRecord): Promise<AnyRecord[]> {
  const results = await Promise.allSettled(macroSeriesForEvent(event).map((id) => fetchFredHistory(id)));
  return results.filter((r) => r.status === 'fulfilled').map((r: any) => r.value);
}
async function analyzeEventBatch(events: AnyRecord[]) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return { events, error: "OPENAI_API_KEY belum dikonfigurasi di Supabase Edge Function Secrets." };
  if (!events.length) return { events, error: null };

  const now = Date.now();
  const historical = await Promise.all(events.map((event) => getHistoricalMacroContext(event)));
  const selected = events.map((event, index) => ({
    id: event.id, name: event.name, countryCode: event.countryCode, currency: event.currency,
    time: event.time, timeMode: event.timeMode, importance: event.importance,
    analysisWindow: analysisWindowLabel(eventAnalysisPhase(event, Date.now())),
    unit: event.unit, actual: event.actual, forecast: event.forecast,
    previous: event.previous, revisedPrevious: event.revisedPrevious,
    historicalMacroContext: historical[index],
  }));
  const prompt = `Anda analis makroekonomi dan dampak pasar. Tahap analisis ditentukan oleh analysisWindow pada setiap agenda. Pada H-7/H-3 buat bias awal yang konservatif dan sebutkan data yang masih ditunggu; pada H-1/1 jam/30 menit perbarui berdasarkan data aktual yang tersedia dan risiko menjelang rilis; saat agenda berlangsung atau baru dirilis prioritaskan actual vs forecast dan perubahan ekspektasi suku bunga; pada evaluasi 15 menit/1 jam/4 jam jelaskan reaksi pasar yang benar-benar tersedia. Jangan mengklaim membaca pidato atau reaksi harga jika sumbernya tidak disediakan. Analisis SETIAP agenda berikut secara terpisah untuk ENAM instrumen: XAUUSD, BTCUSD, EURUSD, GBPUSD, USDJPY, US30.
Gunakan actual/forecast/previous/revisedPrevious hanya jika tersedia. Gunakan historicalMacroContext dari FRED sebagai konteks tren historis resmi (observasi terakhir, bukan data konsensus). Bandingkan pola rilis sebelumnya jika konteksnya cukup dan jelaskan keterbatasannya. Jangan menyebut nilai historis sebagai forecast konsensus. Jika forecast tidak tersedia, buat tiga skenario bersyarat lebih tinggi, sesuai, dan lebih rendah dari ekspektasi pasar yang belum diketahui; tandai konsensus tidak tersedia. Jangan mengarang angka, jadwal, harga, atau berita. Jika actual belum dirilis, buat skenario bersyarat berdasarkan surprise (actual vs forecast) dan tulis jelas bahwa ini PRA-RILIS. Jika data penting kosong atau hubungan instrumen tidak cukup kuat, pilih WAIT dan jelaskan data apa yang kurang.
Untuk SETIAP instrumen berikan bias BUY, SELL, atau WAIT; buyPct, sellPct, waitPct dengan jumlah tepat 100; confidence 0-100 yang terpisah dari skor skenario; dan reason yang menyebut faktor data serta transmisi pasar. Jangan menyamakan arah USD dengan arah emas/crypto. Persentase adalah skor skenario model, BUKAN probabilitas profit, win rate, atau jaminan hasil. Jangan memberi angka sama untuk semua aset. Bila ragu, WAIT lebih baik daripada sinyal palsu.
Berikan summaryBias, reason makro, dan dataStatus PRE_RELEASE, RELEASED, atau INSUFFICIENT_DATA.
Balas JSON murni: {"items":[{"id":"id-event","summaryBias":"BULLISH|BEARISH|NEUTRAL","reason":"alasan makro dan skenario bersyarat","dataStatus":"PRE_RELEASE|RELEASED|INSUFFICIENT_DATA","impacts":[{"symbol":"XAUUSD","bias":"BUY|SELL|WAIT","buyPct":40,"sellPct":35,"waitPct":25,"confidence":65,"reason":"alasan spesifik aset"}]}]}. Setiap event wajib memuat keenam instrumen tepat satu kali.
EVENTS=${JSON.stringify(selected)}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt, max_output_tokens: 5000 }),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  let data: AnyRecord;
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Respons OpenAI tidak valid (HTTP ${response.status})`); }
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);

  const parsed = parseJsonText(extractResponseText(data));
  const byId = new Map((Array.isArray(parsed.items) ? parsed.items : []).map((item: AnyRecord) => [String(item.id), item]));
  const enriched = events.map((event) => {
    const item: AnyRecord | undefined = byId.get(String(event.id));
    if (!item) return { ...event, ai: { available: false, bias: "NEUTRAL", reason: "Analisis AI tidak mengembalikan agenda ini. Tidak ada persentase yang dibuat-buat; status WAIT sampai analisis tersedia.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "WAIT", buyPct: 0, sellPct: 0, waitPct: 100, confidence: 0, reason: "Analisis untuk instrumen ini belum tersedia." })) } };
    const rawImpacts = Array.isArray(item.impacts) ? item.impacts : [];
    const impacts = SYMBOLS.map((symbol) => {
      const found = rawImpacts.find((impact: AnyRecord) => String(impact.symbol).toUpperCase() === symbol);
      if (!found) return { symbol, bias: "WAIT", buyPct: 0, sellPct: 0, waitPct: 100, confidence: 0, reason: "AI belum memberikan analisis untuk instrumen ini." };
      const rawBuy = Number(found.buyPct), rawSell = Number(found.sellPct), rawWait = Number(found.waitPct);
      const valid = [rawBuy, rawSell, rawWait].every((v) => Number.isFinite(v) && v >= 0);
      const sum = valid ? rawBuy + rawSell + rawWait : 0;
      const buyPct = sum > 0 ? Math.round(rawBuy / sum * 100) : 0;
      const sellPct = sum > 0 ? Math.round(rawSell / sum * 100) : 0;
      const waitPct = sum > 0 ? 100 - buyPct - sellPct : 100;
      const bias = ["BUY", "SELL", "WAIT"].includes(String(found.bias).toUpperCase()) ? String(found.bias).toUpperCase() : "WAIT";
      const confidence = Number.isFinite(Number(found.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(found.confidence)))) : 0;
      return { symbol, bias, buyPct, sellPct, waitPct, confidence, reason: String(found.reason || "Alasan belum tersedia.") };
    });
    const summaryBias = String(item.summaryBias || "NEUTRAL").toUpperCase();
    return { ...event, ai: {
      available: true,
      bias: ["BULLISH", "BEARISH", "NEUTRAL"].includes(summaryBias) ? summaryBias : "NEUTRAL",
      reason: String(item.reason || "Bukti belum cukup untuk menyimpulkan dampak."),
      analysisWindow: analysisWindowLabel(eventAnalysisPhase(event, now)),
      nextUpdate: eventTimestamp(event.time) > now ? "Akan diperbarui otomatis pada tahap waktu berikutnya saat kalender dimuat ulang." : "Evaluasi pasca-rilis memerlukan data aktual dan reaksi harga terbaru.",
      dataStatus: ["PRE_RELEASE", "RELEASED", "INSUFFICIENT_DATA"].includes(item.dataStatus) ? item.dataStatus : "INSUFFICIENT_DATA",
      impacts, updatedAt: new Date().toISOString(),
    }};
  });  return { events: enriched, error: null };
}


const AI_ANALYSIS_CACHE = new Map<string, { fingerprint: string; phase: string; at: number; event: AnyRecord }>();
function eventAnalysisPhase(event: AnyRecord, now = Date.now()): string {
  const delta = eventTimestamp(event.time) - now;
  if (delta <= -4 * 60 * 60 * 1000) return "post-4h";
  if (delta <= -60 * 60 * 1000) return "post-1h";
  if (delta <= -15 * 60 * 1000) return "post-15m";
  if (delta <= 0) return "live";
  if (delta <= 30 * 60 * 1000) return "pre-30m";
  if (delta <= 60 * 60 * 1000) return "pre-1h";
  if (delta <= 24 * 60 * 60 * 1000) return "pre-24h";
  if (delta <= 3 * 24 * 60 * 60 * 1000) return "pre-3d";
  if (delta <= 7 * 24 * 60 * 60 * 1000) return "pre-7d";
  return "early-watch";
}
function analysisWindowLabel(phase: string): string {
  const labels: Record<string,string> = { "early-watch":"Pemantauan awal (lebih dari H-7)", "pre-7d":"H-7 sampai H-3", "pre-3d":"H-3 sampai H-1", "pre-24h":"H-1 sampai H-1 jam", "pre-1h":"1 jam sampai 30 menit sebelum agenda", "pre-30m":"30 menit terakhir sebelum agenda", "live":"Agenda sedang berlangsung / baru dirilis", "post-15m":"Evaluasi 15 menit setelah agenda", "post-1h":"Evaluasi 1 jam setelah agenda", "post-4h":"Evaluasi 4 jam setelah agenda" };
  return labels[phase] || "Pemantauan agenda";
}
function analysisFingerprint(event: AnyRecord): string {
  return JSON.stringify([event.id,event.actual,event.forecast,event.previous,event.revisedPrevious,event.time]);
}

async function analyzeEvents(events: AnyRecord[]) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return { events: events.map((event) => ({ ...event, ai: { available: false, bias: "NEUTRAL", reason: "OPENAI_API_KEY belum dikonfigurasi. Tidak ada persentase yang dibuat-buat.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "WAIT", buyPct: 0, sellPct: 0, waitPct: 100, confidence: 0, reason: "Analisis AI belum tersedia." })) } })), error: "OPENAI_API_KEY belum dikonfigurasi di Supabase Edge Function Secrets." };
  if (!events.length) return { events, error: null };

  const now = Date.now();
  const ready: AnyRecord[] = [];
  const output = new Map<string, AnyRecord>();
  for (const event of events) {
    const key = String(event.id);
    const fingerprint = analysisFingerprint(event);
    const phase = eventAnalysisPhase(event, now);
    const cached = AI_ANALYSIS_CACHE.get(key);
    if (cached && cached.fingerprint === fingerprint && cached.phase === phase && now - cached.at < 5 * 60 * 1000) {
      output.set(key, cached.event);
    } else ready.push(event);
  }

  // Analyze one event per OpenAI request to avoid truncated JSON for six instrument impacts.
  // Remaining events stay explicitly WAIT until a subsequent calendar refresh.
  const batchSize = 1;
  const errors: string[] = [];
  const deferred = ready.slice(batchSize);
  for (const event of deferred) {
    output.set(String(event.id), { ...event, ai: { available: false, bias: "NEUTRAL", reason: "Analisis AI dijadwalkan pada pembaruan berikutnya agar kalender tetap responsif.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "WAIT", buyPct: 0, sellPct: 0, waitPct: 100, confidence: 0, reason: "Menunggu analisis AI pada pembaruan berikutnya." })) } });
  }
  for (let i = 0; i < Math.min(ready.length, batchSize); i += batchSize) {
    const batch = ready.slice(i, i + batchSize);
    try {
      const result = await analyzeEventBatch(batch);
      for (const analyzedRaw of result.events) {
        const analyzed: AnyRecord = analyzedRaw as AnyRecord;
        output.set(String(analyzed.id), analyzed);
        AI_ANALYSIS_CACHE.set(String(analyzed.id), {
          fingerprint: analysisFingerprint(analyzed),
          phase: eventAnalysisPhase(analyzed, now),
          at: now,
          event: analyzed,
        });
      }
      if (result.error) errors.push(result.error);
    } catch (error) {
      errors.push(messageOf(error));
      for (const event of batch) {
        const failed = { ...event, ai: { available: false, bias: "NEUTRAL", reason: "Analisis AI gagal. Tidak ada skor BUY/SELL yang direkayasa; tunggu pembaruan.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "WAIT", buyPct: 0, sellPct: 0, waitPct: 100, confidence: 0, reason: "Analisis belum tersedia." })) } };
        output.set(String(event.id), failed);
      }
    }
  }
  return { events: events.map((event) => output.get(String(event.id)) || event), error: errors.length ? errors.join(" | ") : null };
}


const NEWS_CACHE: { at: number; payload: AnyRecord } = { at: 0, payload: { items: [], errors: [] } };
function decodeNewsXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function newsTag(block: string, tag: string): string {
  const m=block.match(new RegExp("<"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+tag+">","i"));
  return m ? decodeNewsXml(m[1]).trim() : "";
}
async function getMarketNews() {
  if (Date.now()-NEWS_CACHE.at < 120000 && NEWS_CACHE.payload.items.length) return { ...NEWS_CACHE.payload, cached: true };
  const topics=[["Global Markets","global financial markets economy central banks"],["Crypto","cryptocurrency Bitcoin Ethereum digital assets"],["Forex","forex currency markets dollar euro yen"],["Commodities","gold silver crude oil commodities"],["Stocks & Indices","global stock markets equities indices earnings"]];
  const settled=await Promise.allSettled(topics.map(async ([category,q])=>{
    const url=new URL("https://news.google.com/rss/search");url.searchParams.set("q",q);url.searchParams.set("hl","en-US");url.searchParams.set("gl","US");url.searchParams.set("ceid","US:en");
    const res=await fetch(url.toString(),{headers:{"User-Agent":"RitelAI-Vision/1.0","Accept":"application/rss+xml, application/xml"},signal:AbortSignal.timeout(6500)});
    if(!res.ok)throw new Error(category+" RSS HTTP "+res.status);
    const xml=await res.text();
    return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,8).map(m=>{
      const x=m[1],date=Date.parse(newsTag(x,"pubDate"));
      return {title:newsTag(x,"title"),url:newsTag(x,"link"),source:newsTag(x,"source")||"Google News",publishedAt:Number.isFinite(date)?new Date(date).toISOString():null,category};
    }).filter(x=>x.title&&/^https?:\/\//i.test(x.url));
  }));
  const items=settled.flatMap(x=>x.status==="fulfilled"?x.value:[]);
  const unique=[...new Map(items.map(x=>[x.url,x])).values()].sort((a,b)=>Date.parse(b.publishedAt||"")-Date.parse(a.publishedAt||"")).slice(0,30);
  const payload={items:unique,errors:settled.filter(x=>x.status==="rejected").map(x=>messageOf(x.reason))};
  if(unique.length){NEWS_CACHE.at=Date.now();NEWS_CACHE.payload=payload;}
  return {...payload,cached:false};
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return reply({ status: "error", error: "Gunakan metode POST." }, 405);

  let body: AnyRecord;
  try { body = await request.json(); }
  catch { return reply({ status: "error", error: "Body request harus berupa JSON." }, 400); }
  if (body?.action === "market_news") {
    try { return reply({ status: "ok", source: "Google News RSS", generatedAt: new Date().toISOString(), ...await getMarketNews() }); }
    catch (error) { return reply({ status: "ok", source: "Google News RSS", items: NEWS_CACHE.payload.items, errors: [messageOf(error)], cached: true }); }
  }
  if (body?.action !== "market_calendar") {
    return reply({ status: "error", error: "Aksi tidak dikenal. Gunakan action: market_calendar atau market_news." }, 400);
  }

  try {
    // Provider failures are returned as a partial 200 response so the UI can show
    // the exact failed source instead of the generic Supabase non-2xx message.
    const quoteResults = await Promise.allSettled(SYMBOLS.map((symbol) => getTick(symbol)));
    const quotes = quoteResults.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled").map((result) => result.value);
    const quoteErrors = quoteResults.filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => messageOf(result.reason));
  
    let providerEvents: AnyRecord[] = [];
    let calendarError: string | null = null;
    try { providerEvents = await getCalendar(); }
    catch (error) { calendarError = messageOf(error); }
    // Gabungkan feed ekonomi live dengan jadwal rilis resmi agar NFP/FOMC/CPI/PPI/GDP/PCE
    // yang sudah diumumkan tetap muncul walau feed agregator belum memuatnya.
    let events: AnyRecord[] = mergeCalendarEvents(providerEvents, getOfficialScheduledEvents());
  
    let aiError: string | null = null;
    if (events.length) {
      try {
        const result = await analyzeEvents(events);
        events = result.events;
        aiError = result.error;
      } catch (error) {
        aiError = messageOf(error);
        events = events.map((event) => ({
          ...event,
          ai: { available: false, bias: "NEUTRAL", reason: "Analisis AI gagal; periksa konfigurasi server. Jangan gunakan sebagai sinyal transaksi.", impacts: [] },
        }));
      }
    } else if (!Deno.env.get("OPENAI_API_KEY")) {
      aiError = "OPENAI_API_KEY belum dikonfigurasi di Supabase Secrets.";
    }
  
    return reply({
      status: "ok",
      generatedAt: new Date().toISOString(),
      quotes,
      quoteErrors,
      events,
      calendarError,
      aiError,
      calendarSource: "BiQuote + jadwal resmi BLS, Federal Reserve, dan BEA",
      priceSource: "BiQuote MT5 feed",
      diagnostics: {
        requestedSymbols: [...SYMBOLS],
        receivedSymbols: quotes.map((quote) => quote.key),
        calendarCount: events.length,
        calendarLimit: null,
        calendarRange: "remaining-November-2026-through-2026-12-31-Asia/Jakarta",
        maximumUpcomingEvents: null,
        futureOnly: true,
        openAIConfigured: Boolean(Deno.env.get("OPENAI_API_KEY")),
      },
      disclaimer: "Harga berasal dari penyedia pihak ketiga dan tidak dijamin sama dengan harga broker. Data dapat tertunda atau tidak tersedia. Bias AI bersifat kualitatif, bukan probabilitas profit atau win rate.",
    });
  } catch (error) {
    // Never leak an unhandled provider/runtime exception as a generic non-2xx to the customer UI.
    return reply({
      status: "ok",
      generatedAt: new Date().toISOString(),
      quotes: [],
      quoteErrors: [],
      events: [],
      calendarError: messageOf(error),
      aiError: null,
      calendarSource: "BiQuote + jadwal resmi BLS, Federal Reserve, dan BEA",
      diagnostics: { requestedSymbols: [...SYMBOLS], receivedSymbols: [], calendarCount: 0, partial: true },
      disclaimer: "Data kalender/harga sementara tidak tersedia. Jangan gunakan sebagai sinyal transaksi.",
    });
  }
});