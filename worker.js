// deploy trigger
// ============================================================
// KUMAR COMMODITY OPTIONS — Crude Oil & Natural Gas Options Analyst
// (v3: uses Upstox Instrument Search API — no bulk file download)
// ============================================================

const UPSTOX_AUTH_URL = "https://api.upstox.com/v2/login/authorization/dialog";
const UPSTOX_TOKEN_URL = "https://api.upstox.com/v2/login/authorization/token";
const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
const UPSTOX_QUOTES_URL = "https://api.upstox.com/v2/market-quote/quotes";
const UPSTOX_GREEKS_URL = "https://api.upstox.com/v3/market-quote/option-greek";
const UPSTOX_HIST_URL = "https://api.upstox.com/v2/historical-candle";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return await handleDashboard(env);
      if (url.pathname === "/login") return handleLogin(env, url);
      if (url.pathname === "/callback") return await handleCallback(request, env, url);
      if (url.pathname === "/api/data") return await handleApiData(env);
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Error: " + err.message + "\n" + (err.stack || ""), { status: 500 });
    }
  },
};

function handleLogin(env, url) {
  const redirectUri = `${url.origin}/callback`;
  const authUrl = `${UPSTOX_AUTH_URL}?response_type=code&client_id=${env.UPSTOX_API_KEY}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return Response.redirect(authUrl, 302);
}

async function handleCallback(request, env, url) {
  const code = url.searchParams.get("code");
  if (!code) return new Response("No code received from Upstox", { status: 400 });
  const redirectUri = `${url.origin}/callback`;
  const body = new URLSearchParams({
    code,
    client_id: env.UPSTOX_API_KEY,
    client_secret: env.UPSTOX_API_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(UPSTOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const data = await res.json();
  if (!data.access_token) return new Response("Token exchange failed: " + JSON.stringify(data), { status: 400 });
  await env.COMMODITY_KV.put("access_token", data.access_token);
  return Response.redirect(url.origin + "/", 302);
}

async function getToken(env) {
  return await env.COMMODITY_KV.get("access_token");
}

async function searchInstruments(token, query, params) {
  const usp = new URLSearchParams({ query, exchanges: "MCX", records: "30", ...params });
  const res = await fetch(`${UPSTOX_SEARCH_URL}?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const j = await res.json();
  return (j.status === "success" && j.data) ? j.data : [];
}

async function fetchFullQuotes(token, instrumentKeys) {
  if (!instrumentKeys.length) return {};
  const encoded = instrumentKeys.map((k) => encodeURIComponent(k)).join(",");
  const res = await fetch(`${UPSTOX_QUOTES_URL}?instrument_key=${encoded}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const j = await res.json();
  return j.data || {};
}

async function fetchGreeks(token, instrumentKeys) {
  if (!instrumentKeys.length) return null;
  try {
    const encoded = instrumentKeys.map((k) => encodeURIComponent(k)).join(",");
    const res = await fetch(`${UPSTOX_GREEKS_URL}?instrument_key=${encoded}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.status !== "success" || !j.data) return null;
    return j.data;
  } catch (e) {
    return null;
  }
}

async function fetchDailyCandles(token, instrumentKey, days = 60) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d) => d.toISOString().split("T")[0];
  const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/day/${fmt(to)}/${fmt(from)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const j = await res.json();
  const candles = (j.data && j.data.candles) || [];
  return candles.slice().reverse().map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function trendFromCandles(candles) {
  const closes = candles.map((c) => c.close);
  if (closes.length < 25) return { trend: "NEUTRAL", rsi: null, ltp: closes.length ? closes[closes.length - 1] : null };
  const e9 = ema(closes, 9), e21 = ema(closes, 21);
  const lastE9 = e9[e9.length - 1], lastE21 = e21[e21.length - 1];
  const r = rsi(closes, 14);
  let trend = "NEUTRAL";
  if (lastE9 > lastE21 && r > 50) trend = "BULLISH";
  else if (lastE9 < lastE21 && r < 50) trend = "BEARISH";
  return { trend, rsi: r ? +r.toFixed(1) : null, ltp: +closes[closes.length - 1].toFixed(2) };
}

function computeMaxPain(strikesData) {
  let minPain = Infinity, maxPainStrike = null;
  for (const target of strikesData) {
    let totalPayout = 0;
    for (const row of strikesData) {
      if (row.ceOI) totalPayout += Math.max(0, target.strike - row.strike) * row.ceOI;
      if (row.peOI) totalPayout += Math.max(0, row.strike - target.strike) * row.peOI;
    }
    if (totalPayout < minPain) { minPain = totalPayout; maxPainStrike = target.strike; }
  }
  return maxPainStrike;
}

function buildConfidence({ trend, pcr, oiSkew, rsiVal }) {
  let score = 50;
  const reasons = [];
  if (trend === "BULLISH") { score += 12; reasons.push("EMA9 above EMA21 on futures — short-term uptrend"); }
  else if (trend === "BEARISH") { score += 12; reasons.push("EMA9 below EMA21 on futures — short-term downtrend"); }
  else { score -= 10; reasons.push("EMA9/EMA21 flat or crossing — no clear trend"); }
  if (rsiVal != null) {
    if (rsiVal > 70 || rsiVal < 30) { score -= 8; reasons.push("RSI at extreme (" + rsiVal + ") — reversal risk"); }
    else if ((trend === "BULLISH" && rsiVal > 50 && rsiVal < 68) || (trend === "BEARISH" && rsiVal < 50 && rsiVal > 32)) {
      score += 10; reasons.push("RSI (" + rsiVal + ") confirms trend without being overextended");
    }
  }
  if (pcr != null) {
    if (trend === "BULLISH" && pcr > 1.1) { score += 10; reasons.push("PCR " + pcr + " (>1.1) — put writers support bullish view"); }
    else if (trend === "BEARISH" && pcr < 0.9) { score += 10; reasons.push("PCR " + pcr + " (<0.9) — call writers support bearish view"); }
    else { score -= 5; reasons.push("PCR " + pcr + " does not clearly confirm the futures trend"); }
  }
  if (oiSkew) reasons.push(oiSkew);
  score = Math.max(0, Math.min(95, score));
  return { score: Math.round(score), reasons };
}

async function handleApiData(env) {
  const token = await getToken(env);
  if (!token) return json({ error: "NOT_LOGGED_IN" }, 401);

  const symbols = [
    { label: "CRUDE OIL", query: "CRUDEOIL" },
    { label: "NATURALGAS", query: "NATURALGAS" },
  ];

  const result = {};

  for (const sym of symbols) {
    const futs = await searchInstruments(token, sym.query, { instrument_types: "FUT" });
    futs.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
    const nearFut = futs.find((f) => new Date(f.expiry).getTime() >= Date.now()) || futs[0];
    if (!nearFut) { result[sym.label] = { error: "NO_FUTURE_FOUND" }; continue; }

    const candles = await fetchDailyCandles(token, nearFut.instrument_key, 60);
    const t = trendFromCandles(candles);
    const spot = t.ltp || 0;

    const optsRaw = await searchInstruments(token, sym.query, { instrument_types: "CE,PE" });
    const byStrikeDist = optsRaw
      .map((o) => ({ ...o, dist: Math.abs(o.strike_price - spot) }))
      .sort((a, b) => a.dist - b.dist);
    const nearStrikes = [...new Set(byStrikeDist.map((o) => o.strike_price))].slice(0, 10);
    const relevantOpts = optsRaw.filter((o) => nearStrikes.includes(o.strike_price));

    const optionKeys = relevantOpts.map((o) => o.instrument_key);
    const quoteMap = await fetchFullQuotes(token, optionKeys);
    const byInstrumentKey = {};
    for (const k in quoteMap) byInstrumentKey[quoteMap[k].instrument_token] = quoteMap[k];

    const strikesData = nearStrikes.map((strike) => {
      const ce = relevantOpts.find((o) => o.strike_price === strike && o.instrument_type === "CE");
      const pe = relevantOpts.find((o) => o.strike_price === strike && o.instrument_type === "PE");
      const ceQ = ce ? byInstrumentKey[ce.instrument_key] : null;
      const peQ = pe ? byInstrumentKey[pe.instrument_key] : null;
      return {
        strike,
        ce: ce ? { instrument_key: ce.instrument_key, trading_symbol: ce.trading_symbol, lot_size: ce.lot_size, ltp: ceQ ? ceQ.last_price : null, oi: ceQ ? ceQ.oi : null } : null,
        pe: pe ? { instrument_key: pe.instrument_key, trading_symbol: pe.trading_symbol, lot_size: pe.lot_size, ltp: peQ ? peQ.last_price : null, oi: peQ ? peQ.oi : null } : null,
        ceOI: ceQ ? ceQ.oi || 0 : 0,
        peOI: peQ ? peQ.oi || 0 : 0,
      };
    });

    const totalCallOI = strikesData.reduce((s, r) => s + r.ceOI, 0);
    const totalPutOI = strikesData.reduce((s, r) => s + r.peOI, 0);
    const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : null;
    const maxPain = strikesData.some((r) => r.ceOI || r.peOI) ? computeMaxPain(strikesData) : null;

    let oiSkew = null;
    const topCallOI = strikesData.slice().sort((a, b) => b.ceOI - a.ceOI)[0];
    const topPutOI = strikesData.slice().sort((a, b) => b.peOI - a.peOI)[0];
    if (topCallOI && topCallOI.ceOI > 0) oiSkew = "Highest Call OI at strike " + topCallOI.strike + " (resistance)";
    if (topPutOI && topPutOI.peOI > 0) oiSkew = (oiSkew ? oiSkew + ". " : "") + "Highest Put OI at strike " + topPutOI.strike + " (support)";

    const conf = buildConfidence({ trend: t.trend, pcr, oiSkew, rsiVal: t.rsi });

    let strategy = "NO TRADE", recommendation = null, greeks = null;
    if (conf.score >= 70 && (t.trend === "BULLISH" || t.trend === "BEARISH")) {
      const wantType = t.trend === "BULLISH" ? "ce" : "pe";
      const atmRow = strikesData
        .filter((r) => r[wantType] && r[wantType].ltp != null && r[wantType].ltp > 0)
        .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
      if (atmRow) {
        const opt = atmRow[wantType];
        const entryPremium = opt.ltp;
        const stopLoss = +(entryPremium * 0.7).toFixed(2);
        const target1 = +(entryPremium * 1.5).toFixed(2);
        const target2 = +(entryPremium * 2.0).toFixed(2);
        const lot = opt.lot_size || 1;
        strategy = wantType === "ce" ? "Buy Call" : "Buy Put";
        recommendation = {
          type: wantType.toUpperCase(), strike: atmRow.strike, trading_symbol: opt.trading_symbol, lot_size: lot,
          entry_premium: entryPremium, stop_loss: stopLoss, target1, target2,
          risk_per_lot: +((entryPremium - stopLoss) * lot).toFixed(0),
          reward1_per_lot: +((target1 - entryPremium) * lot).toFixed(0),
          reward2_per_lot: +((target2 - entryPremium) * lot).toFixed(0),
        };
        const g = await fetchGreeks(token, [opt.instrument_key]);
        if (g) { for (const k in g) { greeks = g[k]; break; } }
      }
    }

    result[sym.label] = {
      spot_futures: t.ltp, trend: t.trend, rsi: t.rsi, confidence: conf.score, confidence_reasons: conf.reasons,
      pcr, total_call_oi: totalCallOI, total_put_oi: totalPutOI, max_pain: maxPain, oi_note: oiSkew,
      strategy, recommendation, greeks, strikes: strikesData, expiry: nearFut.expiry,
    };
  }

  return json(result, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

async function handleDashboard(env) {
  const token = await getToken(env);
  if (!token) return new Response(loginPageHtml(), { headers: { "Content-Type": "text/html" } });
  return new Response(dashboardHtml(), { headers: { "Content-Type": "text/html" } });
}

function loginPageHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kumar Commodity Options</title>
<style>
body{font-family:-apple-system,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#222;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;padding:32px;border-radius:20px;text-align:center;max-width:340px;box-shadow:0 10px 40px rgba(0,0,0,0.25)}
h1{font-size:1.3rem;margin-bottom:8px;color:#4c1d95}
p{color:#666;font-size:0.9rem}
a{display:inline-block;margin-top:20px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:700;box-shadow:0 4px 14px rgba(239,68,68,0.4)}
</style></head>
<body><div class="card">
<h1>Kumar Commodity Options</h1>
<p>Crude Oil & Natural Gas - Options Analyst</p>
<a href="/login">Login with Upstox</a>
</div></body></html>`;
}

function dashboardHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kumar Commodity Options</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:linear-gradient(135deg,#e0e7ff 0%,#fdf2f8 100%);color:#1e293b;margin:0;padding:14px;min-height:100vh}
h1{font-size:1.15rem;margin:4px 0 16px;color:#4338ca;text-align:center}
.card{background:#fff;border-radius:18px;padding:16px;margin-bottom:16px;box-shadow:0 4px 20px rgba(99,102,241,0.15);border-top:5px solid #6366f1}
.symbol{font-size:1.1rem;font-weight:800;margin-bottom:4px;color:#3730a3}
.sec{margin-top:10px;padding-top:8px;border-top:1px dashed #e2e8f0}
.sec-title{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;font-weight:800;margin-bottom:4px}
.row{display:flex;justify-content:space-between;padding:3px 0;font-size:0.88rem;color:#475569}
.badge{padding:5px 12px;border-radius:20px;font-weight:800;font-size:0.82rem;display:inline-block;margin:4px 4px 4px 0}
.BULLISH{background:#d1fae5;color:#059669}
.BEARISH{background:#fee2e2;color:#dc2626}
.NEUTRAL{background:#f1f5f9;color:#64748b}
.conf-high{background:linear-gradient(135deg,#34d399,#059669);color:#fff}
.conf-low{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff}
.rec-box{background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px;padding:12px;margin-top:10px}
.rec-title{font-weight:800;color:#92400e;margin-bottom:6px;font-size:0.95rem}
.notrade{background:#e2e8f0;border-radius:12px;padding:12px;margin-top:10px;color:#475569;font-weight:600;font-size:0.88rem}
.reasons{margin-top:6px;padding-left:16px;font-size:0.8rem;color:#64748b}
.reasons li{margin-bottom:2px}
.strike-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:0.76rem}
.strike-table th{background:#eef2ff;color:#4338ca;padding:5px 3px}
.strike-table td{padding:5px 3px;text-align:center;border-bottom:1px solid #f1f5f9}
.CE{color:#059669;font-weight:700}.PE{color:#dc2626;font-weight:700}
.na{color:#cbd5e1;font-style:italic;font-size:0.78rem}
.refresh{color:#94a3b8;font-size:0.75rem;text-align:center;margin-top:8px}
.err{color:#dc2626;font-weight:600;font-size:0.9rem}
</style></head>
<body>
<h1>Kumar Commodity Options</h1>
<div id="app">Loading...</div>
<div class="refresh" id="ts"></div>
<script>
async function load() {
  var app = document.getElementById('app');
  try {
    var res = await fetch('/api/data');
    var data = await res.json();
    if (data.error === 'NOT_LOGGED_IN') {
      app.innerHTML = '<p>Session expired. <a href="/login" style="color:#4338ca;font-weight:700">Login again</a></p>';
      return;
    }
    var html = '';
    var syms = ['CRUDE OIL','NATURALGAS'];
    for (var i = 0; i < syms.length; i++) {
      var sym = syms[i];
      var d = data[sym];
      if (!d || d.error) { html += '<div class="card err">' + sym + ': ' + (d ? d.error : 'no data') + '</div>'; continue; }
      html += '<div class="card">';
      html += '<div class="symbol">' + sym + '</div>';
      html += '<div class="badge ' + d.trend + '">' + d.trend + '</div>';
      html += '<div class="badge ' + (d.confidence >= 70 ? 'conf-high' : 'conf-low') + '">Confidence: ' + d.confidence + '%</div>';

      html += '<div class="sec"><div class="sec-title">Option Chain Analysis</div>';
      html += '<div class="row"><span>PCR (Put/Call OI)</span><b>' + (d.pcr != null ? d.pcr : 'N/A') + '</b></div>';
      html += '<div class="row"><span>Total Call OI</span><span>' + d.total_call_oi.toLocaleString() + '</span></div>';
      html += '<div class="row"><span>Total Put OI</span><span>' + d.total_put_oi.toLocaleString() + '</span></div>';
      html += '<div class="row"><span>Max Pain Strike</span><b>' + (d.max_pain != null ? d.max_pain : 'N/A') + '</b></div>';
      if (d.oi_note) html += '<div class="row" style="font-size:0.78rem;color:#64748b">' + d.oi_note + '</div>';
      html += '</div>';

      html += '<div class="sec"><div class="sec-title">Greeks / IV</div>';
      if (d.greeks) {
        html += '<div class="row"><span>IV</span><span>' + d.greeks.iv + '</span></div>';
      } else {
        html += '<div class="na">Not available via API for MCX options</div>';
      }
      html += '</div>';

      if (d.strategy !== 'NO TRADE' && d.recommendation) {
        var r = d.recommendation;
        html += '<div class="rec-box">';
        html += '<div class="rec-title">' + d.strategy + ': ' + r.type + ' ' + r.strike + '</div>';
        html += '<div class="row"><span>Entry (Premium)</span><b>Rs ' + r.entry_premium + '</b></div>';
        html += '<div class="row"><span>Stop Loss</span><span class="PE">Rs ' + r.stop_loss + '</span></div>';
        html += '<div class="row"><span>Target 1 / Target 2</span><span class="CE">Rs ' + r.target1 + ' / Rs ' + r.target2 + '</span></div>';
        html += '<div class="row"><span>Lot Size</span><span>' + r.lot_size + '</span></div>';
        html += '<div class="row"><span>Risk / Lot</span><span class="PE">Rs ' + r.risk_per_lot + '</span></div>';
        html += '<div class="row"><span>Reward / Lot (T1/T2)</span><span class="CE">Rs ' + r.reward1_per_lot + ' / Rs ' + r.reward2_per_lot + '</span></div>';
        html += '</div>';
      } else {
        html += '<div class="notrade">NO TRADE - confidence below 70% threshold or no clear trend.</div>';
      }

      html += '<div class="sec"><div class="sec-title">Reasons</div><ul class="reasons">';
      for (var j = 0; j < d.confidence_reasons.length; j++) html += '<li>' + d.confidence_reasons[j] + '</li>';
      html += '</ul></div>';

      if (d.strikes && d.strikes.length) {
        html += '<div class="sec"><div class="sec-title">Nearby Strikes (LTP / OI)</div>';
        html += '<table class="strike-table"><tr><th>Strike</th><th>CE LTP/OI</th><th>PE 
html += '<table class="strike-table"><tr><th>Strike</th><th>CE LTP/OI</th><th>PE LTP/OI</th></tr>';
      for (var k = 0; k < d.strikes.length; k++) {
        var s = d.strikes[k];
        var ceTxt = s.ce ? (s.ce.ltp != null ? s.ce.ltp : '-') + ' / ' + (s.ce.oi != null ? s.ce.oi : '-') : '-';
        var peTxt = s.pe ? (s.pe.ltp != null ? s.pe.ltp : '-') + ' / ' + (s.pe.oi != null ? s.pe.oi : '-') : '-';
        html += '<tr><td>' + s.strike + '</td><td class="CE">' + ceTxt + '</td><td class="PE">' + peTxt + '</td></tr>';
      }
      html += '</table></div>';
      }

      html += '</div>';
    }

    app.innerHTML = html;
    document.getElementById('ts').innerText = 'Last updated: ' + new Date().toLocaleTimeString();
  } catch (e) {
    app.innerHTML = '<div class="card err">Error loading data: ' + e.message + '</div>';
  }
}
load();
setInterval(load, 30000);
</script>
</body></html>`;
}
