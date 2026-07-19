const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
const UPSTOX_QUOTES_URL = "https://api.upstox.com/v2/market-quote/quotes";
const UPSTOX_AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog";
const UPSTOX_TOKEN_URL = "https://api.upstox.com/v2/login/authorization/token";

function renderHTML(results) {
  let cards = "";
  for (const q of Object.keys(results)) {
    const r = results[q];
    if (!r.quote || r.quote.status !== "success") {
      cards += `<div class="card"><h2>${q}</h2><p class="err">No data / login needed</p></div>`;
      continue;
    }
    const dataKey = Object.keys(r.quote.data)[0];
    const d = r.quote.data[dataKey];
    const changeColor = d.net_change >= 0 ? "green" : "red";
    cards += `
      <div class="card">
        <h2>${q}</h2>
        <p class="symbol">${r.trading_symbol} &middot; Expiry ${r.expiry}</p>
        <p class="ltp">₹${d.last_price} <span class="${changeColor}">(${d.net_change >= 0 ? "+" : ""}${d.net_change})</span></p>
        <table>
          <tr><td>Open</td><td>${d.ohlc.open}</td><td>High</td><td>${d.ohlc.high}</td></tr>
          <tr><td>Low</td><td>${d.ohlc.low}</td><td>Close</td><td>${d.ohlc.close}</td></tr>
          <tr><td>Volume</td><td>${d.volume}</td><td>OI</td><td>${d.oi}</td></tr>
          <tr><td>Avg Price</td><td>${d.average_price}</td><td>OI Day High</td><td>${d.oi_day_high}</td></tr>
          <tr><td>Lower Ckt</td><td>${d.lower_circuit_limit}</td><td>Upper Ckt</td><td>${d.upper_circuit_limit}</td></tr>
        </table>
        <p class="time">Updated: ${d.timestamp}</p>
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kumar Commodity Options</title>
<style>
  body { font-family: -apple-system, Roboto, sans-serif; background:#0f1115; color:#eee; margin:0; padding:16px; }
  h1 { font-size:20px; margin-bottom:4px; }
  .refresh { font-size:13px; color:#9ab; margin-bottom:16px; display:block; }
  .card { background:#1a1d24; border-radius:12px; padding:16px; margin-bottom:16px; }
  .card h2 { margin:0 0 4px 0; font-size:18px; }
  .symbol { color:#9aa; font-size:13px; margin:0 0 8px 0; }
  .ltp { font-size:26px; font-weight:bold; margin:0 0 12px 0; }
  .green { color:#3ecf5e; font-size:16px; }
  .red { color:#ff5c5c; font-size:16px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  td { padding:6px 4px; border-bottom:1px solid #2a2d34; }
  td:nth-child(1), td:nth-child(3) { color:#9aa; width:25%; }
  .time { font-size:11px; color:#667; margin-top:10px; }
  .err { color:#ff5c5c; }
  a.login { display:inline-block; margin-top:8px; color:#6cf; }
</style>
</head>
<body>
  <h1>Kumar Commodity Options</h1>
  <a class="refresh login" href="/login">🔑 Refresh login (do this each morning)</a>
  ${cards}
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/login") {
        const redirectUri = `${url.origin}/callback`;
        const authUrl = `${UPSTOX_AUTH_URL}?response_type=code&client_id=${env.UPSTOX_API_KEY}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        return Response.redirect(authUrl, 302);
      }

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (!code) return new Response("No code", { status: 400 });
        const redirectUri = `${url.origin}/callback`;
        const body = new URLSearchParams({
          code, client_id: env.UPSTOX_API_KEY, client_secret: env.UPSTOX_API_SECRET,
          redirect_uri: redirectUri, grant_type: "authorization_code",
        });
        const res = await fetch(UPSTOX_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: body.toString(),
        });
        const data = await res.json();
        if (!data.access_token) return new Response(JSON.stringify(data), { status: 400 });
        await env.COMMODITY_KV.put("access_token", data.access_token);
        return Response.redirect(url.origin + "/", 302);
      }

      if (url.pathname === "/set-token") {
        const token = url.searchParams.get("token");
        if (!token) return new Response("Provide ?token=", { status: 400 });
        await env.COMMODITY_KV.put("access_token", token);
        return new Response("Token saved to KV. Visit / to test.", { status: 200 });
      }

      if (url.pathname === "/json") {
        // raw JSON still available for debugging at /json
        let token = await env.COMMODITY_KV.get("access_token");
        if (!token) token = env.UPSTOX_ACCESS_TOKEN;
        if (!token) return new Response('No token. Visit /login', { status: 400 });
        const results = await fetchAll(token);
        return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
      }

      if (url.pathname === "/") {
        let token = await env.COMMODITY_KV.get("access_token");
        if (!token) token = env.UPSTOX_ACCESS_TOKEN;
        if (!token) {
          return new Response(
            `<a href="/login">Login with Upstox</a> (do this each morning)`,
            { headers: { "Content-Type": "text/html" } }
          );
        }
        const results = await fetchAll(token);
        return new Response(renderHTML(results), { headers: { "Content-Type": "text/html" } });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }

    async function fetchAll(token) {
      const results = {};
      for (const q of ["CRUDEOIL", "NATURALGAS"]) {
        const usp = new URLSearchParams({ query: q, exchanges: "MCX", instrument_types: "FUT", records: "10" });
        const searchRes = await fetch(`${UPSTOX_SEARCH_URL}?${usp.toString()}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        const searchJson = await searchRes.json();

        if (searchJson.status !== "success" || !searchJson.data || !searchJson.data.length) {
          results[q] = { search: searchJson };
          continue;
        }

        const contracts = [...searchJson.data].sort(
          (a, b) => new Date(a.expiry) - new Date(b.expiry)
        );
        const nearest = contracts[0];
        const instrumentKey = nearest.instrument_key;

        const quoteUsp = new URLSearchParams({ instrument_key: instrumentKey });
        const quoteRes = await fetch(`${UPSTOX_QUOTES_URL}?${quoteUsp.toString()}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        const quoteJson = await quoteRes.json();

        results[q] = {
          instrument_key: instrumentKey,
          expiry: nearest.expiry,
          trading_symbol: nearest.trading_symbol,
          quote: quoteJson,
        };
      }
      return results;
    }
  },
};
