const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
const UPSTOX_QUOTES_URL = "https://api.upstox.com/v2/market-quote/quotes";
const UPSTOX_AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog";
const UPSTOX_TOKEN_URL = "https://api.upstox.com/v2/login/authorization/token";

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

      if (url.pathname === "/") {
        let token = await env.COMMODITY_KV.get("access_token");
        if (!token) token = env.UPSTOX_ACCESS_TOKEN;
        if (!token) {
          return new Response(
            '<a href="/login">Login with Upstox</a> (do this each morning) or set one via /set-token?token=YOUR_TOKEN',
            { headers: { "Content-Type": "text/html" } }
          );
        }

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

        return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  },
};
