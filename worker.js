const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
const UPSTOX_QUOTES_URL = "https://api.upstox.com/v2/market-quote/quotes";
const UPSTOX_AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog";
const UPSTOX_TOKEN_URL = "https://api.upstox.com/v2/login/authorization/token";

const THEME = {
  CRUDEOIL: { grad: "linear-gradient(135deg,#ff8a00,#e52e71)", light: "#fff4e8" },
  NATURALGAS: { grad: "linear-gradient(135deg,#00c6ff,#0072ff)", light: "#e8f6ff" },
};

function renderHTML(results) {
  const keys = Object.keys(results);
  let tabButtons = "";
  let panels = "";

  keys.forEach((q, i) => {
    const r = results[q];
    const theme = THEME[q] || { grad: "linear-gradient(135deg,#999,#666)", light: "#f2f2f2" };
    const active = i === 0 ? "active" : "";

    tabButtons += `<button class="tab ${active}" style="background:${theme.grad}" onclick="showTab('${q}')" id="btn-${q}">${q}</button>`;

    if (!r.quote || r.quote.status !== "success") {
      panels += `<div class="panel ${active}" id="panel-${q}"><p class="err">No data / login needed</p></div>`;
      return;
    }
    const dataKey = Object.keys(r.quote.data)[0];
    const d = r.quote.data[dataKey];
    const up = d.net_change >= 0;
    const changeColor = up ? "#0a9d3f" : "#e0263f";
    const arrow = up ? "▲" : "▼";

    panels += `
      <div class="panel ${active}" id="panel-${q}">
        <div class="hero" style="background:${theme.grad}">
          <p class="symbol">${r.trading_symbol}</p>
          <p class="expiry">Expiry ${r.expiry}</p>
          <p class="ltp">₹${d.last_price}</p>
          <p class="change" style="color:#fff">${arrow} ${up ? "+" : ""}${d.net_change}</p>
        </div>
        <div class="stats" style="background:${theme.light}">
          <div class="stat"><span>Open</span><b>${d.ohlc.open}</b></div>
          <div class="stat"><span>High</span><b>${d.ohlc.high}</b></div>
          <div class="stat"><span>Low</span><b>${d.ohlc.low}</b></div>
          <div class="stat"><span>Close</span><b>${d.ohlc.close}</b></div>
          <div class="stat"><span>Volume</span><b>${d.volume}</b></div>
          <div class="stat"><span>OI</span><b>${d.oi}</b></div>
          <div class="stat"><span>Avg Price</span><b>${d.average_price}</b></div>
          <div class="stat"><span>Lower Ckt</span><b>${d.lower_circuit_limit}</b></div>
          <div class="stat"><span>Upper Ckt</span><b>${d.upper_circuit_limit}</b></div>
        </div>
        <p class="time">Updated: ${d.timestamp}</p>
      </div>`;
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kumar Commodity Options</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, sans-serif; background:#f5f6fa; color:#222; margin:0; padding:16px; }
  h1 { font-size:22px; margin:0 0 4px 0; background:linear-gradient(90deg,#6a11cb,#2575fc); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .refresh { font-size:13px; color:#2575fc; text-decoration:none; display:inline-block; margin-bottom:16px; }
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tab { flex:1; border:none; padding:12px 0; border-radius:12px; color:#fff; font-weight:bold; font-size:15px; opacity:0.5; }
  .tab.active { opacity:1; box-shadow:0 4px 12px rgba(0,0,0,0.2); }
  .panel { display:none; }
  .panel.active { display:block; }
  .hero { border-radius:16px; padding:20px; color:#fff; margin-bottom:0; }
  .symbol { margin:0; font-size:14px; opacity:0.9; }
  .expiry { margin:2px 0 10px 0; font-size:12px; opacity:0.8; }
  .ltp { margin:0; font-size:34px; font-weight:bold; }
  .change { margin:4px 0 0 0; font-size:16px; font-weight:bold; }
  .stats { border-radius:0 0 16px 16px; padding:12px 16px; display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:8px; }
  .stat { display:flex; flex-direction:column; background:#fff; border-radius:10px; padding:8px 10px; }
  .stat span { font-size:11px; color:#888; }
  .stat b { font-size:16px; color:#222; }
  .time { font-size:11px; color:#999; text-align:right; }
  .err { color:#e0263f; padding:20px; background:#fff; border-radius:12px; }
</style>
</head>
<body>
  <h1>Kumar Commodity Options</h1>
  <a class="refresh" href="/login">🔑 Refresh login (do this each morning)</a>
  <div class="tabs">${tabButtons}</div>
  ${panels}
  <script>
    function showTab(q) {
      document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
      document.getElementById('btn-' + q).classList.add('active');
      document.getElementById('panel-' + q).classList.add('active');
    }
  </script>
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
