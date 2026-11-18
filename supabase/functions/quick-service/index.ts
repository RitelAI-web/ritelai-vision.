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
  // Kalender dinamis: sertakan rilis yang baru lewat (untuk evaluasi pascarilis)
  // dan agenda 180 hari ke depan. Semua waktu API tetap ISO UTC.
  const start = new Date('2026-01-01T00:00:00.000Z').getTime();
  const end = now + 180 * 24 * 60 * 60 * 1000;
  // Ambil arsip per bulan agar batas 500 item tidak memotong rilis awal tahun.
  // Rentang mendatang diminta terpisah agar kalender tetap terisi.
  const ranges: Array<{from:number;to:number}> = [];
  let cursor = start;
  while (cursor < now) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1);
    ranges.push({from:cursor,to:Math.min(next-1,now)});
    cursor = next;
  }
  ranges.push({from:now,to:end});
  const fetched = await Promise.all(ranges.map(async range => {
    const url = new URL("https://biquote.io/api/calendar");
    url.searchParams.set("from", new Date(range.from).toISOString());
    url.searchParams.set("to", new Date(range.to).toISOString());
    url.searchParams.set("limit", "500");
    const result = await fetchJson(url.toString(), 8000);
    if (!Array.isArray(result)) throw new Error("Format kalender ekonomi dari penyedia tidak dikenali");
    return result as AnyRecord[];
  }));
  const unique = new Map<string, AnyRecord>();
  for (const batch of fetched) for (const event of batch) {
    const stamp = eventTimestamp(event?.time??event?.timestamp??event?.datetime??event?.date);
    const name = String(event?.name??event?.title??event?.event??"").trim().toLowerCase();
    if (!Number.isFinite(stamp) || !name) continue;
    unique.set(String(event?.id??event?.eventId??name+"|"+stamp), event);
  }
  const rows = [...unique.values()];
  if (!rows.length) throw new Error("Penyedia kalender tidak mengembalikan data");
  // Gunakan satu feed rentang 30 hari ke belakang hingga 180 hari ke depan.
  // Dengan begitu rilis kemarin/hari ini tidak hilang akibat endpoint arsip terpisah.
  const historicalRows: AnyRecord[] = rows.filter((event: AnyRecord) => {
    const stamp=eventTimestamp(event?.time??event?.timestamp??event?.datetime??event?.date);
    return Number.isFinite(stamp) && stamp < now;
  });
  const categoryOf = (name: unknown) => {
    const n=String(name||"").toLowerCase();
    if (/non.?farm|payroll|unemployment|employment situation|average hourly earnings|jobless claims|initial claims|continuing claims/.test(n)) return "NFP";
    if (/consumer price|consumer inflation|cpi|core inflation/.test(n)) return "CPI";
    if (/producer price|producer inflation|ppi/.test(n)) return "PPI";
    if (/fomc|federal reserve|fed funds|interest rate decision|policy rate|federal funds rate|monetary policy statement|fed chair/.test(n)) return "FOMC";
    if (/crude oil|oil inventories|petroleum|opec|brent|wti/.test(n)) return "OIL";
    return "";
  };
  const historyByCategory = new Map<string, AnyRecord[]>();
  for (const old of historicalRows) {
    const category=categoryOf(old?.name??old?.title??old?.event);
    const rawTime=old?.time??old?.timestamp??old?.datetime??old?.date;
    const stamp=eventTimestamp(rawTime);
    if (!category || !Number.isFinite(stamp)) continue;
    const bucket=historyByCategory.get(category)||[];
    bucket.push({date:new Date(stamp).toISOString(),name:old.name??old.title??old.event??category,
      actual:old.actual??old.actualValue??old.actual_value??null,
      forecast:old.forecast??old.consensus??old.estimate??old.forecastValue??old.forecast_value??null,
      previous:old.previous??old.previousValue??old.previous_value??null,
      unit:old.unit??old.measureUnit??old.measure_unit??"",source:old.source??old.provider??"BiQuote"});
    historyByCategory.set(category,bucket);
  }
  for (const bucket of historyByCategory.values()) bucket.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  const pastReleases = [...historyByCategory.entries()].flatMap(([category,items]) => items.map(item=>({...item,category}))).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,120);

  // The calendar provider supplies the impact classification. Accept every HIGH-impact event,
  // regardless of event name or country, instead of maintaining a narrow hand-written whitelist.
  const events = rows
    .map((event: AnyRecord) => {
      const rawTime = event?.time ?? event?.timestamp ?? event?.datetime ?? event?.date;
      const timestamp = eventTimestamp(rawTime);
      return { event, timestamp };
    })
    .filter(({ event, timestamp }: { event: AnyRecord; timestamp: number }) => {
      if (!event || !Number.isFinite(timestamp) || timestamp < start || timestamp > end) return false;
      const eventName = String(event.name ?? event.title ?? event.event ?? "").trim();
      const rawImpact = String(event.importance ?? event.impact ?? event.impactLevel ?? event.impact_level ?? "").trim().toLowerCase();
      const isHighImpact = ["high", "high impact", "3", "3.0", "tinggi", "red"].includes(rawImpact) || Number(rawImpact) === 3;
      // Only provider-labelled HIGH impact is included; no guessed impact labels or event-name whitelist.
      return eventName.length > 0 && isHighImpact;
    })
    .map(({ event, timestamp }: { event: AnyRecord; timestamp: number }) => ({
      ...event,
      id: String(event.id ?? event.eventId ?? `${event.name ?? event.title ?? event.event}-${timestamp}`),
      time: new Date(timestamp).toISOString(),
      name: event.name ?? event.title ?? event.event ?? "Rilis ekonomi",
      importance: (() => {
        const raw = String(event.importance ?? event.impact ?? event.impactLevel ?? event.impact_level ?? "").trim().toLowerCase();
        if (["high", "high impact", "3", "3.0", "tinggi", "red"].includes(raw) || Number(raw) === 3) return "high";
        if (["medium", "med", "medium impact", "2", "2.0", "moderate", "orange", "kuning"].includes(raw) || Number(raw) === 2) return "medium";
        if (["low", "low impact", "1", "1.0", "rendah", "yellow"].includes(raw) || Number(raw) === 1) return "low";
        return "unknown";
      })(),
      countryCode: event.countryCode ?? event.country ?? "",
      currency: event.currency ?? "",
      actual: event.actual ?? event.actualValue ?? event.actual_value ?? event.actual_value_formatted ?? null,
      forecast: event.forecast ?? event.consensus ?? event.estimate ?? event.forecastValue ?? event.forecast_value ?? event.consensus_value ?? null,
      previous: event.previous ?? event.previousValue ?? event.previous_value ?? null,
      revisedPrevious: event.revisedPrevious ?? event.revised_previous ?? event.revisedFrom ?? event.revised_from ?? null,
      unit: event.unit ?? event.measureUnit ?? event.measure_unit ?? event.units ?? "",
      referencePeriod: event.referencePeriod ?? event.reference_period ?? event.period ?? "",
      eventSource: event.source ?? event.provider ?? event.sourceName ?? "BiQuote",
      valueSource: event.valueSource ?? event.value_source ?? event.source ?? event.provider ?? "BiQuote",
      sourceUrl: event.sourceUrl ?? event.source_url ?? event.url ?? null,
      dataUpdatedAt: event.updatedAt ?? event.updated_at ?? event.lastUpdate ?? event.last_update ?? event.timestampUpdated ?? null,
      importanceLevel: event.importance ?? "unknown",
      historicalReleases: (historyByCategory.get(categoryOf(event.name ?? event.title ?? event.event)) || []).slice(-6),
    }))
    .filter((event: AnyRecord) => { const n=String(event.name||"").toLowerCase(); return /non.?farm|payroll|unemployment|employment situation|consumer price|cpi|producer price|ppi|fomc|federal reserve|fed funds|interest rate decision|policy rate/.test(n); })
    .sort((a: AnyRecord, b: AnyRecord) => Date.parse(a.time) - Date.parse(b.time));
  return Object.assign(events, { pastReleases });
}
function getOfficialScheduledEvents(): AnyRecord[] {
  // Jadwal yang sudah diumumkan oleh BLS, Federal Reserve, dan BEA.
  // Semua waktu disimpan sebagai ISO UTC; kartu frontend mengubahnya ke WIB.
  const rows: AnyRecord[] = [
    { id: "official-fomc-minutes-2026-11-18", name: "Federal Reserve — FOMC Minutes (rapat 27–28 Oktober)", time: "2026-11-18T19:00:00.000Z", currency: "USD", countryCode: "US", source: "Federal Reserve", sourceUrl: "https://www.federalreserve.gov/newsevents/2026-November.htm", scheduleNote: "Jadwal resmi Federal Reserve; rilis 14.00 ET (19 November 02.00 WIB)." },
    { id: "official-ecb-hicp-2026-11-18", name: "Euro area seasonally adjusted HICP — October 2026 (ECB dataset)", time: "2026-11-18T11:00:00.000Z", currency: "EUR", countryCode: "EU", source: "European Central Bank", sourceUrl: "https://www.ecb.europa.eu/press/calendars/statscal/ges/html/sthicp.en.html", scheduleNote: "Jadwal ECB resmi: 12:00 CET = 18:00 WIB. Ini rilis HICP tersesuaikan musiman, bukan headline Eurostat CPI y/y." },
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

function compareCalendarValues(event: AnyRecord): AnyRecord {
  const pickValue = (...values: unknown[]): unknown => values.find((value) => value != null && String(value).trim() !== "") ?? null;
  const unwrapValue = (value: unknown): unknown => {
    if (value && typeof value === "object") {
      const item = value as AnyRecord;
      return pickValue(item.value, item.raw, item.formatted, item.text, item.amount);
    }
    return value;
  };
  const actual = unwrapValue(pickValue(event.actual, event.actualValue, event.actual_value, event.actual_value_formatted));
  const forecast = unwrapValue(pickValue(event.forecast, event.consensus, event.estimate, event.forecastValue, event.forecast_value, event.consensus_value));
  const previous = unwrapValue(pickValue(event.previous, event.previousValue, event.previous_value));
  const revisedPrevious = unwrapValue(pickValue(event.revisedPrevious, event.revised_previous, event.revisedFrom, event.revised_from));
  const dataUpdatedAt = pickValue(event.dataUpdatedAt, event.updatedAt, event.updated_at, event.lastUpdate, event.last_update, event.timestampUpdated);
  const eventSource = pickValue(event.eventSource, event.source, event.provider, event.sourceName) ?? "BiQuote";
  const numeric = (value: unknown): number | null => {
    if (value == null || value === "") return null;
    const cleaned = String(value).replace(/,/g, "").replace(/%/g, "").replace(/[^0-9.+-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const a = numeric(actual), f = numeric(forecast), p = numeric(previous);
  const hasActual = actual != null && String(actual).trim() !== "";
  const hasForecast = forecast != null && String(forecast).trim() !== "";
  const surprise = a == null || f == null ? null : Number((a - f).toFixed(6));
  const surpriseLabel = surprise == null ? "PENDING" : surprise > 0 ? "ABOVE_FORECAST" : surprise < 0 ? "BELOW_FORECAST" : "IN_LINE";
  return {
    ...event,
    actual, forecast, previous, revisedPrevious, dataUpdatedAt, eventSource,
    releaseStatus: hasActual ? "RELEASED" : "UPCOMING",
    actualVsForecast: surpriseLabel,
    surpriseValue: surprise,
    forecastVsPrevious: f == null || p == null ? "UNAVAILABLE" : f > p ? "FORECAST_ABOVE_PREVIOUS" : f < p ? "FORECAST_BELOW_PREVIOUS" : "FORECAST_IN_LINE",
    hasActual, hasForecast, hasPrevious: previous != null && String(previous).trim() !== "",
    valueDisplay: { actual: actual ?? "Belum tersedia", forecast: forecast ?? "Belum tersedia", previous: previous ?? "Belum tersedia", revisedPrevious: revisedPrevious ?? "Belum tersedia", unit: event.unit || "" },
  };
}

function mergeCalendarEvents(providerEvents: AnyRecord[], officialEvents: AnyRecord[]): AnyRecord[] {
  const merged = new Map<string, AnyRecord>();
  for (const event of [...providerEvents, ...officialEvents]) {
    const key = `${String(event.name ?? event.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${Date.parse(event.time)}`;
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, compareCalendarValues(event));
      continue;
    }
    // Jadwal resmi boleh mengonfirmasi waktu/sumber, tetapi tidak boleh menghapus
    // Actual, Forecast, Previous atau revisi konsensus dari feed kalender.
    const preferred = event.scheduleStatus === "official_scheduled" ? event : prior;
    const other = preferred === event ? prior : event;
    const combined: AnyRecord = {
      ...other,
      ...preferred,
      actual: preferred.actual ?? preferred.actualValue ?? preferred.actual_value ?? other.actual ?? other.actualValue ?? other.actual_value ?? null,
      forecast: preferred.forecast ?? preferred.consensus ?? preferred.estimate ?? preferred.forecastValue ?? preferred.forecast_value ?? other.forecast ?? other.consensus ?? other.estimate ?? other.forecastValue ?? other.forecast_value ?? null,
      previous: preferred.previous ?? preferred.previousValue ?? preferred.previous_value ?? other.previous ?? other.previousValue ?? other.previous_value ?? null,
      revisedPrevious: preferred.revisedPrevious ?? preferred.revised_previous ?? other.revisedPrevious ?? other.revised_previous ?? null,
      dataUpdatedAt: preferred.dataUpdatedAt ?? preferred.updatedAt ?? preferred.updated_at ?? other.dataUpdatedAt ?? other.updatedAt ?? other.updated_at ?? null,
      eventSource: other.eventSource ?? other.source ?? other.provider ?? preferred.eventSource ?? preferred.source ?? "BiQuote",
      valueSource: other.valueSource ?? other.source ?? other.provider ?? null,
    };
    merged.set(key, compareCalendarValues(combined));
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
  if (/nfp|non.?farm|employment situation|payroll|unemployment|average hourly earnings/.test(name)) return ['PAYEMS', 'UNRATE', 'CES0500000003'];
  if (/consumer price|cpi/.test(name)) return ['CPIAUCSL', 'CPILFESL'];
  if (/producer price|ppi/.test(name)) return ['PPIACO', 'PPIFIS'];
  if (/pce|personal consumption/.test(name)) return ['PCEPI', 'PCEPILFE'];
  if (/fomc|federal reserve|fed funds|interest rate decision|policy rate|interest rate/.test(name)) return ['FEDFUNDS', 'DGS2', 'DGS10', 'DFEDTARU', 'DFEDTARL'];
  if (/crude oil|oil inventories|petroleum|opec|brent|wti|energy stock/.test(name)) return ['DCOILWTICO', 'DCOILBRENTEU'];
  if (/retail sales/.test(name)) return ['RSAFS'];
  if (/gdp|gross domestic/.test(name)) return ['GDP'];
  return [];
}
const FRED_HISTORY_CACHE = new Map<string, { at: number; value: AnyRecord }>();
async function fetchFredHistory(seriesId: string): Promise<AnyRecord> {
  const cached = FRED_HISTORY_CACHE.get(seriesId);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.value;
  try {
    const response = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + encodeURIComponent(seriesId), { headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(2200) });
    if (!response.ok) throw new Error('FRED HTTP ' + response.status);
    const csv = await response.text();
    const rows = csv.trim().split(/\\r?\\n/).slice(1).filter((line) => line && !line.endsWith(',.'));
    const observations = rows.slice(-8).map((line) => { const cells = line.split(','); return { date: cells[0], value: cells.slice(1).join(',') }; }).filter((row) => row.value && row.value !== '.');
    const value = { series: seriesId, observations };
    FRED_HISTORY_CACHE.set(seriesId, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (cached) return { ...cached.value, stale: true };
    throw error;
  }
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
    historicalMacroContext: historical[index], historicalReleases: event.historicalReleases || [],
  }));
  const prompt = `Anda analis makroekonomi dan dampak pasar. Tahap analisis ditentukan oleh analysisWindow pada setiap agenda. Pada H-7/H-3 buat bias awal yang konservatif dan sebutkan data yang masih ditunggu; pada H-1/1 jam/30 menit perbarui berdasarkan data aktual yang tersedia dan risiko menjelang rilis; saat agenda berlangsung atau baru dirilis prioritaskan actual vs forecast dan perubahan ekspektasi suku bunga; pada evaluasi 15 menit/1 jam/4 jam jelaskan reaksi pasar yang benar-benar tersedia. Jangan mengklaim membaca pidato atau reaksi harga jika sumbernya tidak disediakan. Analisis SETIAP agenda berikut secara terpisah untuk ENAM instrumen: XAUUSD, BTCUSD, EURUSD, GBPUSD, USDJPY, US30.
Gunakan actual/forecast/previous/revisedPrevious hanya jika tersedia. Sebelum menilai arah, tuliskan status kelengkapan ketiga nilai tersebut: Previous, Forecast (konsensus pasar), dan Actual (hasil resmi). Forecast wajib diperlakukan sebagai ekspektasi sebelum rilis; jangan menggantinya dengan nilai historis FRED. Jika Actual dan Forecast tersedia bersamaan, jelaskan secara eksplisit apakah Actual di atas, di bawah, atau sesuai Forecast serta makna surprise-nya untuk instrumen terkait. Jika Actual belum tersedia, tandai PRA-RILIS dan jangan membuat seolah-olah perbandingan sudah terjadi. Jika Forecast kosong, sebutkan "Konsensus/Forecast belum tersedia dari feed" dan gunakan skenario bersyarat tanpa angka forecast rekaan. Klasifikasikan setiap agenda menurut jenis datanya dan jangan gunakan satu template alasan untuk semua berita. NFP/Employment: bedakan payroll, tingkat pengangguran, dan average hourly earnings/upah. CPI: nilai inflasi konsumen headline dan core. PPI: nilai harga produsen headline/core dan potensi pass-through ke CPI; jangan samakan PPI dengan CPI. FOMC/Fed: bedakan keputusan resmi, pernyataan, dan minutes; sebutkan naik/tahan/turun hanya jika keputusan resmi tersedia. Oil/EIA/OPEC: jelaskan Brent/WTI, persediaan, pasokan OPEC, permintaan global, serta implikasi energi terhadap inflasi; jika harga minyak live tidak disediakan jangan mengarang harga. Untuk tiap agenda tampilkan eventCategory, historicalComparison, rateOutlook, oilContext, dan fundamentalBias khusus agenda. Data yang tidak tersedia harus disebutkan jelas. Gunakan historicalReleases dari kalender untuk menampilkan tabel rilis bulanan sebelumnya berisi tanggal, Actual, Forecast, Previous, dan sumber. Ini adalah riwayat konsensus provider bila tersedia; jangan mengisi forecast yang kosong dari FRED. Untuk data USD, actual lebih tinggi dari forecast umumnya mendukung USD pada payroll/upah/pertumbuhan, tetapi untuk inflasi CPI/PPI yang lebih tinggi dapat mendukung USD lewat ekspektasi Fed lebih ketat dan sekaligus menekan emas; actual lebih rendah umumnya kebalikannya. Selalu jelaskan pengecualian, komponen data, revisi previous, dan konteks kebijakan; jangan gunakan aturan 'lebih tinggi = good USD' untuk semua indikator secara buta. Tambahkan historicalReleases pada output JSON. Gunakan historicalMacroContext dari FRED sebagai konteks tren historis resmi (observasi terakhir, bukan data konsensus). Bandingkan pola rilis sebelumnya jika konteksnya cukup dan jelaskan keterbatasannya. Jangan menyebut nilai historis sebagai forecast konsensus. Jika forecast tidak tersedia, buat tiga skenario bersyarat lebih tinggi, sesuai, dan lebih rendah dari ekspektasi pasar yang belum diketahui; tandai konsensus tidak tersedia. Jangan mengarang angka, jadwal, harga, atau berita. Jika actual belum dirilis, buat skenario bersyarat berdasarkan surprise (actual vs forecast) dan tulis jelas bahwa ini PRA-RILIS. Jika forecast belum tersedia, jangan otomatis memberi WAIT 100%: berikan tiga skenario bersyarat (data lebih kuat/lemah/sejalan) dan skor skenario BUY/SELL/WAIT yang berjumlah 100 berdasarkan konteks historis FRED, arah USD/yield bila tersedia, sifat instrumen, dan ketidakpastian. Pilih bias BUY atau SELL jika satu arah lebih didukung; gunakan WAIT hanya bila bukti benar-benar seimbang atau transmisi ke aset tidak dapat dipertanggungjawabkan. Tegaskan ini bias PRA-RILIS, bukan instruksi entry sebelum rilis. Jika data penting kosong, turunkan confidence dan jelaskan apa yang kurang; jangan jadikan kekosongan satu field sebagai alasan otomatis WAIT 100%.
Untuk SETIAP instrumen berikan bias BUY, SELL, atau WAIT; buyPct, sellPct, waitPct dengan jumlah tepat 100; confidence 0-100 yang terpisah dari skor skenario; dan reason yang menyebut faktor data serta transmisi pasar. Jangan menyamakan arah USD dengan arah emas/crypto. Persentase adalah skor skenario model, BUKAN probabilitas profit, win rate, atau jaminan hasil. Jangan memberi angka sama untuk semua aset. Bila ragu, WAIT lebih baik daripada sinyal palsu.
Berikan summaryBias, reason makro, dan dataStatus PRE_RELEASE, RELEASED, atau INSUFFICIENT_DATA. KHUSUS EVENT FOMC MINUTES: ini adalah notulen rapat terdahulu, BUKAN keputusan suku bunga baru dan bukan pidato langsung. Sebelum waktu rilis, tulis skenario bersyarat saja dan jangan mengaku mengetahui isi notulen. Setelah notulen tersedia, nilai nada HAWKISH/DOVISH dari pembahasan risiko inflasi, ketahanan pasar tenaga kerja/pertumbuhan, dukungan atau keberatan terhadap perubahan suku bunga, perbedaan pandangan anggota, dan petunjuk keputusan rapat berikutnya. Bandingkan nada notulen dengan ekspektasi pasar yang benar-benar tersedia; jangan mengarang konsensus. Jelaskan kemungkinan USD dan GOLD secara terpisah. Reaksi harga tetap perlu dikonfirmasi melalui yield/DXY dan struktur teknikal XAUUSD; jika data reaksi belum tersedia, tandai belum terkonfirmasi. Tambahkan fundamentalBias khusus USD dan GOLD: stance HAWKISH, DOVISH, NEUTRAL, atau PENDING; usd dan gold masing-masing BULLISH, BEARISH, NEUTRAL, atau PENDING; reason menjelaskan transmisi fundamental; confidence 0-100; dataStatus. Jangan menebak stance dari skor BUY/SELL teknikal. Jika hanya jadwal tanpa data/konteks cukup, gunakan PENDING dan confidence 0.
Balas JSON murni: {"items":[{"id":"id-event","summaryBias":"BULLISH|BEARISH|NEUTRAL","reason":"alasan makro dan skenario bersyarat","dataStatus":"PRE_RELEASE|RELEASED|INSUFFICIENT_DATA","fundamentalBias":{"stance":"HAWKISH|DOVISH|NEUTRAL|PENDING","usd":"BULLISH|BEARISH|NEUTRAL|PENDING","gold":"BULLISH|BEARISH|NEUTRAL|PENDING","reason":"alasan fundamental USD dan GOLD","confidence":60,"dataStatus":"PRE_RELEASE|RELEASED|INSUFFICIENT_DATA"},"eventCategory":"NFP/CPI/PPI/FOMC/OIL/OTHER","historicalComparison":"perbandingan historis","rateOutlook":"dampak potensial ke ekspektasi suku bunga","oilContext":"konteks minyak","historicalReleases":[{"date":"YYYY-MM-DD","actual":"nilai","forecast":"nilai","previous":"nilai","unit":"unit","source":"sumber"}],"impacts":[{"symbol":"XAUUSD","bias":"BUY|SELL|WAIT","buyPct":40,"sellPct":35,"waitPct":25,"confidence":65,"reason":"alasan spesifik aset"}]}]}. Setiap event wajib memuat keenam instrumen tepat satu kali.
EVENTS=${JSON.stringify(selected)}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 12000,
      text: { format: { type: "json_object" } },
    }),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  let data: AnyRecord;
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Respons OpenAI tidak valid (HTTP ${response.status})`); }
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  if (data?.status === "incomplete" || data?.incomplete_details) {
    throw new Error("Analisis AI terpotong sebelum JSON selesai. Coba refresh kembali.");
  }

  const responseText = extractResponseText(data);
  if (!responseText.trim()) throw new Error("OpenAI tidak mengembalikan teks analisis. Periksa status respons dan batas token.");
  const parsed = parseJsonText(responseText);
  const byId = new Map((Array.isArray(parsed.items) ? parsed.items : []).map((item: AnyRecord) => [String(item.id), item]));
  const enriched = events.map((event) => {
    const item: AnyRecord | undefined = byId.get(String(event.id));
    if (!item) return { ...event, ai: { available: false, bias: "NEUTRAL", reason: "Analisis AI tidak mengembalikan agenda ini. Tidak ada persentase yang dibuat-buat; status WAIT sampai analisis tersedia.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "PENDING", buyPct: null, sellPct: null, waitPct: null, confidence: 0, reason: "Analisis AI untuk instrumen ini belum selesai; belum ada bias pasar yang dinilai." })) } };
    const rawImpacts = Array.isArray(item.impacts) ? item.impacts : [];
    const impacts = SYMBOLS.map((symbol) => {
      const found = rawImpacts.find((impact: AnyRecord) => String(impact.symbol).toUpperCase() === symbol);
      if (!found) return { symbol, bias: "PENDING", buyPct: null, sellPct: null, waitPct: null, confidence: 0, reason: "Analisis AI untuk instrumen ini belum selesai; belum ada bias pasar yang dinilai." };
      const rawBuy = Number(found.buyPct), rawSell = Number(found.sellPct), rawWait = Number(found.waitPct);
      const sum = rawBuy + rawSell + rawWait;
      const reason = String(found.reason || "").trim();
      const confidenceRaw = Number(found.confidence);
      const valid = [rawBuy, rawSell, rawWait].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
        && Number.isFinite(sum) && Math.abs(sum - 100) <= 1
        && reason.length > 12 && Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 100;
      if (!valid) return { symbol, bias: "PENDING", buyPct: null, sellPct: null, waitPct: null, confidence: 0, reason: "Skor BUY/SELL/WAIT atau alasan tidak lolos validasi. Persentase disembunyikan sampai analisis valid." };
      const buyPct = Math.round(rawBuy), sellPct = Math.round(rawSell), waitPct = 100 - buyPct - sellPct;
      const ranked = [{ bias: "BUY", score: buyPct }, { bias: "SELL", score: sellPct }, { bias: "WAIT", score: waitPct }].sort((a, b) => b.score - a.score);
      const bias = ranked[0].score - ranked[1].score >= 8 ? ranked[0].bias : "WAIT";
      const confidence = Math.round(confidenceRaw);
      return { symbol, bias, buyPct, sellPct, waitPct, confidence, reason };
    });
    const summaryBias = String(item.summaryBias || "NEUTRAL").toUpperCase();
    return { ...event, ai: {
      available: true,
      bias: ["BULLISH", "BEARISH", "NEUTRAL"].includes(summaryBias) ? summaryBias : "NEUTRAL",
      reason: String(item.reason || "Bukti belum cukup untuk menyimpulkan dampak."),
      analysisWindow: analysisWindowLabel(eventAnalysisPhase(event, now)),
      nextUpdate: eventTimestamp(event.time) > now ? "Akan diperbarui otomatis pada tahap waktu berikutnya saat kalender dimuat ulang." : "Evaluasi pasca-rilis memerlukan data aktual dan reaksi harga terbaru.",
      dataStatus: ["PRE_RELEASE", "RELEASED", "INSUFFICIENT_DATA"].includes(item.dataStatus) ? item.dataStatus : "INSUFFICIENT_DATA",
      fundamentalBias: (() => { const f=item.fundamentalBias||{}; const stance=String(f.stance||"PENDING").toUpperCase(), usd=String(f.usd||"PENDING").toUpperCase(), gold=String(f.gold||"PENDING").toUpperCase(); const valid=["HAWKISH","DOVISH","NEUTRAL","PENDING"].includes(stance)&&["BULLISH","BEARISH","NEUTRAL","PENDING"].includes(usd)&&["BULLISH","BEARISH","NEUTRAL","PENDING"].includes(gold)&&String(f.reason||"").trim().length>12; return valid?{stance,usd,gold,reason:String(f.reason).trim(),confidence:Math.max(0,Math.min(100,Number(f.confidence)||0)),dataStatus:["PRE_RELEASE","RELEASED","INSUFFICIENT_DATA"].includes(f.dataStatus)?f.dataStatus:"INSUFFICIENT_DATA"}:{stance:"PENDING",usd:"PENDING",gold:"PENDING",reason:"Analisis fundamental USD dan GOLD belum lolos validasi. Tunggu data dan analisis berikutnya.",confidence:0,dataStatus:"INSUFFICIENT_DATA"}; })(),
      eventCategory: String(item.eventCategory || "Makroekonomi umum"),
      historicalComparison: String(item.historicalComparison || "Data historis pembanding belum cukup atau belum tersedia."),
      rateOutlook: String(item.rateOutlook || "Dampak pada ekspektasi suku bunga belum dapat dinilai dari data yang tersedia."),
      oilContext: String(item.oilContext || "Tidak ada data minyak yang relevan atau tersedia untuk agenda ini."),
      historicalReleases: Array.isArray(item.historicalReleases) ? item.historicalReleases.slice(-6).map((r: AnyRecord) => ({ date:String(r.date||""), actual:r.actual??null, forecast:r.forecast??null, previous:r.previous??null, unit:String(r.unit||""), source:String(r.source||"Kalender") })) : [],
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
  return JSON.stringify([event.id,event.actual,event.forecast,event.previous,event.revisedPrevious,event.time,event.dataUpdatedAt]);
}

async function analyzeEvents(events: AnyRecord[]) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return { events: events.map((event) => ({ ...event, ai: { available: false, bias: "NEUTRAL", reason: "OPENAI_API_KEY belum dikonfigurasi. Tidak ada persentase yang dibuat-buat.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "PENDING", buyPct: null, sellPct: null, waitPct: null, confidence: 0, reason: "Analisis AI belum tersedia; belum ada bias pasar yang dinilai." })) } })), error: "OPENAI_API_KEY belum dikonfigurasi di Supabase Edge Function Secrets." };
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

  // Prioritaskan agenda HIGH impact terdekat, lalu medium/low.
  // Sisanya diproses bertahap pada auto-refresh berikutnya.
  const impactRank = (event: AnyRecord) => event.importance === "high" ? 0 : event.importance === "medium" ? 1 : event.importance === "low" ? 2 : 3;
  // Dahulukan agenda terdekat; dampak menjadi pemecah seri agar berita penting
  // tidak tertahan oleh kalender panjang yang masih jauh.
  ready.sort((a, b) => {
    const da = Math.abs(eventTimestamp(a.time) - now), db = Math.abs(eventTimestamp(b.time) - now);
    const nearA = da <= 24 * 60 * 60 * 1000, nearB = db <= 24 * 60 * 60 * 1000;
    if (nearA !== nearB) return nearA ? -1 : 1;
    if (nearA && nearB) return da - db || impactRank(a) - impactRank(b);
    return impactRank(a) - impactRank(b) || da - db;
  });
  // Tiga agenda per request menghasilkan payload yang terlalu besar dan berisiko
  // memotong JSON enam instrumen. Satu agenda per request menjaga hasil lengkap.
  const batchSize = 1;
  const errors: string[] = [];
  const deferred = ready.slice(batchSize);
  for (const event of deferred) {
    output.set(String(event.id), { ...event, ai: { available: false, bias: "NEUTRAL", reason: "Agenda masuk antrean analisis berikutnya agar kalender tetap responsif.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "WAIT", buyPct: 0, sellPct: 0, waitPct: 100, confidence: 0, reason: "Agenda belum diproses pada refresh ini; ini status antrean, bukan bias pasar WAIT." })) } });
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
        const failed = { ...event, ai: { available: false, bias: "NEUTRAL", reason: "Analisis AI gagal. Tidak ada skor BUY/SELL yang direkayasa; tunggu pembaruan.", impacts: SYMBOLS.map((symbol) => ({ symbol, bias: "PENDING", buyPct: null, sellPct: null, waitPct: null, confidence: 0, reason: "Analisis AI gagal dimuat; belum ada bias pasar yang dinilai." })) } };
        output.set(String(event.id), failed);
      }
    }
  }
  return { events: events.map((event) => output.get(String(event.id)) || event), error: errors.length ? errors.join(" | ") : null };
}


const NEWS_CACHE: { at: number; payload: AnyRecord } = { at: 0, payload: { items: [], errors: [] } };
const CALENDAR_RESPONSE_CACHE: { at: number; payload: AnyRecord | null } = { at: 0, payload: null };
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
  let trustedServerRequest = false;
  if (body?.action === "check_news_access" || body?.action === "market_calendar" || body?.action === "market_news") {
    const auth = request.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) return reply({ status: "error", error: "Konfigurasi akses paket belum tersedia." }, 503);
    // Server-to-server access is restricted to the project service-role credential.
    // Browser/customer calls still require a valid user session and active Pro/Elite plan.
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const isServiceRoleRequest = auth === `Bearer ${serviceKey}`;
    const cronToken = request.headers.get("x-cron-secret") || "";
    let isCronRequest = false;
    if (!isServiceRoleRequest && cronToken) {
      const { data: validCron, error: cronError } = await admin.rpc("verify_news_push_cron_secret", { p_token: cronToken });
      isCronRequest = !cronError && validCron === true;
    }
    const isTrustedServer = isServiceRoleRequest || isCronRequest;
    trustedServerRequest = isTrustedServer;
    if (!isTrustedServer) {
      if (!auth.startsWith("Bearer ")) return reply({ status: "error", error: "Login diperlukan untuk fitur News." }, 401);
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) return reply({ status: "error", error: "Sesi login tidak valid." }, 401);
      const [{ data: profile }, { data: subscription }] = await Promise.all([
        admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle(),
        admin.from("subscriptions").select("status,ends_at,plans(code)").eq("user_id", userData.user.id).eq("status", "active").gt("ends_at", new Date().toISOString()).order("ends_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const role = String(profile?.role || "").toLowerCase().trim().replace(/[\\s-]+/g, "_");
      const planCode = String((subscription?.plans as any)?.code || "").toLowerCase();
      const allowed = ["owner", "admin", "super_admin"].includes(role) || ["pro", "elite"].includes(planCode);
      if (body?.action === "check_news_access") return reply({ status: "ok", allowed, planCode: ["owner","admin","super_admin"].includes(role) ? "admin" : planCode });
      if (!allowed) return reply({ status: "error", error: "News & Kalender hanya tersedia untuk paket Pro dan Elite aktif. Silakan upgrade paket." }, 403);
    }
  }

  const pushOnly = body?.action === "market_calendar" && body?.pushOnly === true && trustedServerRequest;

  if (body?.action === "market_quotes") {
    const requested = String(body?.symbol || "XAUUSD").toUpperCase();
    if (!SYMBOLS.includes(requested as SymbolKey)) return reply({ status: "error", error: "Instrumen belum didukung feed live." }, 400);
    try {
      const quote = await getTick(requested as SymbolKey);
      return reply({ status: "ok", generatedAt: new Date().toISOString(), quote, source: quote.source, disclaimer: "Tick dari feed pihak ketiga, bukan harga broker pengguna. Interval polling bukan jaminan frekuensi tick." });
    } catch (error) {
      return reply({ status: "ok", generatedAt: new Date().toISOString(), quote: null, statusLabel: "STALE", error: messageOf(error), disclaimer: "Harga tidak tersedia; jangan gunakan snapshot lama untuk entry." });
    }
  }
  if (body?.action === "market_news") {
    try { return reply({ status: "ok", source: "Google News RSS", generatedAt: new Date().toISOString(), ...await getMarketNews() }); }
    catch (error) { return reply({ status: "ok", source: "Google News RSS", items: NEWS_CACHE.payload.items, errors: [messageOf(error)], cached: true }); }
  }
  if (body?.action !== "market_calendar") {
    return reply({ status: "error", error: "Aksi tidak dikenal. Gunakan action: market_quotes, market_calendar, atau market_news." }, 400);
  }
  if (!pushOnly && CALENDAR_RESPONSE_CACHE.payload && Date.now() - CALENDAR_RESPONSE_CACHE.at < 30000) {
    return reply({ ...CALENDAR_RESPONSE_CACHE.payload, cached: true, cacheAgeMs: Date.now() - CALENDAR_RESPONSE_CACHE.at });
  }

  try {
    // Provider failures are returned as a partial 200 response so the UI can show
    // the exact failed source instead of the generic Supabase non-2xx message.
    const quoteResults = pushOnly ? [] : await Promise.allSettled(SYMBOLS.map((symbol) => getTick(symbol)));
    const quotes = quoteResults.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled").map((result) => result.value);
    const quoteErrors = quoteResults.filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => messageOf(result.reason));
  
    let providerEvents: AnyRecord[] = [];
    let calendarError: string | null = null;
    try { providerEvents = await getCalendar(); }
    catch (error) { calendarError = messageOf(error); }
    // Gabungkan feed ekonomi live dengan jadwal rilis resmi agar NFP/FOMC/CPI/PPI/GDP/PCE
    // yang sudah diumumkan tetap muncul walau feed agregator belum memuatnya.
    let events: AnyRecord[] = mergeCalendarEvents(providerEvents, getOfficialScheduledEvents()).filter((event) => { const n=String(event.name||event.title||"").toLowerCase(); return /non.?farm|payroll|unemployment|employment situation|consumer price|cpi|producer price|ppi|fomc|federal reserve|fed funds|interest rate decision|policy rate/.test(n); });
  
    let aiError: string | null = null;
    if (events.length && !pushOnly) {
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
    } else if (!pushOnly && !Deno.env.get("OPENAI_API_KEY")) {
      aiError = "OPENAI_API_KEY belum dikonfigurasi di Supabase Secrets.";
    }
  
    const calendarPayload = {
      status: "ok",
      generatedAt: new Date().toISOString(),
      quotes,
      quoteErrors,
      events,
      pastReleases: (providerEvents as any).pastReleases || [],
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
    };
    if (!pushOnly) {
      CALENDAR_RESPONSE_CACHE.at = Date.now();
      CALENDAR_RESPONSE_CACHE.payload = calendarPayload;
    }
    return reply(calendarPayload);
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