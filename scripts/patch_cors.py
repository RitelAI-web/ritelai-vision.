from pathlib import Path

p = Path("supabase/functions/quick-service/index.ts")
s = p.read_text(encoding="utf-8")

marker = "/* RITELAI_CORS_WRAPPER_V1 */"
if marker in s:
    print("CORS wrapper already applied")
    raise SystemExit(0)

start = "Deno.serve(async (request: Request) => {"
if start not in s:
    raise SystemExit("quick-service Deno handler not found")

# Wrap every response from the handler so browser preflight and POST responses
# consistently carry CORS headers, regardless of which internal return branch ran.
s = s.replace(start, start + """
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    }});
  }
  const __ritelaiResponse = await (async () => {
""", 1)

end = s.rfind("\n});")
if end < 0:
    raise SystemExit("quick-service handler closing not found")

s = s[:end] + """
  })();
  const __ritelaiHeaders = new Headers(__ritelaiResponse.headers);
  __ritelaiHeaders.set("Access-Control-Allow-Origin", "*");
  __ritelaiHeaders.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  __ritelaiHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  __ritelaiHeaders.set("Vary", "Origin");
  return new Response(__ritelaiResponse.body, {
    status: __ritelaiResponse.status,
    statusText: __ritelaiResponse.statusText,
    headers: __ritelaiHeaders,
  });
""" + s[end:]
s = s.replace(start, start + " " + marker, 1)
p.write_text(s, encoding="utf-8")
print("Applied universal CORS and OPTIONS handling to quick-service")
