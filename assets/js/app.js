// ---------- Helpers: formatting ----------
const USD = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
const IDR = (n) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtBTC = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });

function yyyyMmDd(d) { const y = d.getUTCFullYear(); const m = String(d.getUTCMonth() + 1).padStart(2, "0"); const da = String(d.getUTCDate()).padStart(2, "0"); return `${y}-${m}-${da}`; }
function toStartOfUTCDay(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function addDays(d, days) { const nd = new Date(d.getTime()); nd.setUTCDate(nd.getUTCDate() + days); return nd; }
function addMonthsUTC(d, months) { const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); nd.setUTCMonth(nd.getUTCMonth() + months); if (nd.getUTCDate() !== d.getUTCDate()) nd.setUTCDate(0); return nd; }
function generateSchedule(start, end, freq) { const s = []; let d = toStartOfUTCDay(start); const endUTC = toStartOfUTCDay(end); while (d <= endUTC) { s.push(new Date(d.getTime())); d = (freq === "daily") ? addDays(d,1) : (freq === "weekly") ? addDays(d,7) : addMonthsUTC(d,1); } return s; }
function closestPrior(map, iso, maxBackDays=7) { if (map.has(iso)) return map.get(iso); let d = new Date(iso + "T00:00:00Z"); for (let i=0;i<maxBackDays;i++) { d = addDays(d,-1); const key = yyyyMmDd(d); if (map.has(key)) return map.get(key); } return undefined; }

// ---------- Data fetch ----------
async function fetchAllBinanceDaily(startMs, endMs) {
  const out = []; let cursor = startMs; const limit=1000;
  while (cursor<endMs) {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol","BTCUSDT");
    url.searchParams.set("interval","1d");
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endMs));
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url.toString());
    if(!res.ok) throw new Error(`Binance error ${res.status}`);
    const data = await res.json();
    if(!data.length) break;
    for(const row of data) {
      const openTime=row[0]; const close=parseFloat(row[4]); const date=yyyyMmDd(new Date(openTime));
      out.push({ openTime, close, date });
    }
    const lastCloseTime = data[data.length-1][6];
    cursor = lastCloseTime + 1;
    if (data.length < limit) break;
  }
  return out;
}

async function fetchUsdIdrFrankfurter(startISO, endISO) {
  const url=`https://api.frankfurter.app/${startISO}..${endISO}?from=USD&to=IDR`;
  const res=await fetch(url);
  if(!res.ok) throw new Error("Frankfurter error "+res.status);
  const json=await res.json();
  const map=new Map();
  for(const [date,obj] of Object.entries(json.rates||{})) {
    if (obj && typeof obj.IDR === "number") map.set(date, obj.IDR);
  }
  return map;
}
async function fetchUsdIdrExchangerateHost(startISO, endISO) {
  const url=new URL("https://api.exchangerate.host/timeseries");
  url.searchParams.set("start_date", startISO);
  url.searchParams.set("end_date", endISO);
  url.searchParams.set("base","USD");
  url.searchParams.set("symbols","IDR");
  const res=await fetch(url.toString());
  if(!res.ok) throw new Error("ERH error "+res.status);
  const json=await res.json();
  const map=new Map();
  for(const [date,obj] of Object.entries(json.rates||{})) {
    if(obj && typeof obj.IDR === "number") map.set(date, obj.IDR);
  }
  return map;
}
async function fetchUsdIdrLatest() {
  try {
    const r=await fetch("https://api.frankfurter.app/latest?from=USD&to=IDR");
    if(r.ok) {
      const j=await r.json();
      if(j && j.rates && typeof j.rates.IDR === "number") return j.rates.IDR;
    }
  } catch{}
  try {
    const r2=await fetch("https://api.exchangerate.host/latest?base=USD&symbols=IDR");
    if(r2.ok) {
      const j=await r2.json();
      const v=j && j.rates && j.rates.IDR; if(typeof v === "number") return v;
    }
  } catch{}
  return undefined;
}
async function buildUsdIdrTimeseries(startISO, endISO) {
  try { const m=await fetchUsdIdrFrankfurter(startISO, endISO); if(m.size>0) return m; } catch(e){ console.warn(e); }
  try { const m2=await fetchUsdIdrExchangerateHost(startISO, endISO); if(m2.size>0) return m2; } catch(e){ console.warn(e); }
  const latest=await fetchUsdIdrLatest();
  const map=new Map();
  if(typeof latest === "number") {
    let d=new Date(startISO+"T00:00:00Z"); const end=new Date(endISO+"T00:00:00Z");
    while(d<=end) { map.set(yyyyMmDd(d), latest); d=addDays(d,1); }
    map.__fallback_single=true;
  }
  return map;
}

// ---------- DOM refs ----------
const amountInput=document.getElementById("amountInput");
const amountHint=document.getElementById("amountHint");
const amtCurrency=document.getElementById("amtCurrency");
const displayCurrency=document.getElementById("displayCurrency");
const freqSelect=document.getElementById("freqSelect");
const startDate=document.getElementById("startDate");
const endDate=document.getElementById("endDate");
const runBtn=document.getElementById("runBtn");
const errorBox=document.getElementById("errorBox");
const loadingEl=document.getElementById("loading");
const exportCsvBtn=document.getElementById("exportCsvBtn");
const themeBtn=document.getElementById("themeBtn");
const themeIcon=document.getElementById("themeIcon");

const buysTbody=document.getElementById("buysTbody");
const kpiValue=document.getElementById("kpiValue");
const kpiCost=document.getElementById("kpiCost");
const kpiPnL=document.getElementById("kpiPnL");
const kpiBTC=document.getElementById("kpiBTC");
const kpiLastPrice=document.getElementById("kpiLastPrice");

const chartCanvas=document.getElementById("portfolioChart");
const zoomInBtn=document.getElementById("zoomInBtn");
const zoomOutBtn=document.getElementById("zoomOutBtn");
const resetZoomBtn=document.getElementById("resetZoomBtn");

const presetButtons=document.querySelectorAll("[data-preset]");
const transactionsCard=document.getElementById("transactionsCard");
const cardExportBtn=document.getElementById("cardExportBtn");

// Modal
const modalOverlay=document.getElementById("modalOverlay");
const modalPanel=document.getElementById("modalPanel");
const modalClose=document.getElementById("modalClose");
const modalExport=document.getElementById("modalExport");
const buysTbodyFull=document.getElementById("buysTbodyFull");
const filterInput=document.getElementById("filterInput");
const firstPageBtn=document.getElementById("firstPage");
const prevPageBtn=document.getElementById("prevPage");
const nextPageBtn=document.getElementById("nextPage");
const lastPageBtn=document.getElementById("lastPage");
const pageInfo=document.getElementById("pageInfo");
const fullTable=document.getElementById("fullTable");

let chartInstance=null; let lastBuys=[]; let lastFXFallback=false;
// new: per-date maps in selected display currency
let valueSelByDate = new Map();
let costSelByDate = new Map();
let dispCurrency = "IDR";

// pagination/sort state (fixed page size 20)
let sortKey="date"; let sortDir="asc"; let currentPage=1; const pageSize=20;

// ---------- UI helpers ----------
function setLoading(v) { loadingEl.classList.toggle("invisible", !v); runBtn.disabled=v; }
function showError(msg) { errorBox.textContent=msg || ""; }
function getIsDark() { return document.documentElement.classList.contains("dark"); }
function updateThemeIcon() { themeIcon.textContent = getIsDark() ? "🌙" : "☀️"; }
function applyThemeFromStorage() { 
  const saved=localStorage.getItem("theme") || "dark"; 
  const root=document.documentElement; 
  if(saved==="dark") root.classList.add("dark"); else root.classList.remove("dark"); 
  updateThemeIcon();
}
function toggleTheme() { 
  const root=document.documentElement; 
  const isDark=root.classList.toggle("dark"); 
  localStorage.setItem("theme", isDark ? "dark":"light"); 
  updateThemeIcon();
}
applyThemeFromStorage();

function updateAmountHint() { const amt=Number(amountInput.value)||0; const cur=amtCurrency.value; amountHint.textContent=cur==="USD" ? USD(amt) : IDR(amt); }
amountInput.addEventListener("input", updateAmountHint);
amtCurrency.addEventListener("change", updateAmountHint);
updateAmountHint();

// Date constraints
function clampDates() {
  if (startDate.value && endDate.value && startDate.value > endDate.value) {
    endDate.value = startDate.value;
  }
  endDate.min = startDate.value || "";
  startDate.max = endDate.value || "";
}
startDate.addEventListener("change", clampDates);
endDate.addEventListener("change", clampDates);
clampDates();

// ---------- Simulation ----------
async function runSimulation() {
  try {
    showError(""); setLoading(true);
    clampDates();
    const amount = Number(amountInput.value);
    const amtCur = String(amtCurrency.value);
    const dispCur = String(displayCurrency.value);
    dispCurrency = dispCur;
    const freq = String(freqSelect.value);
    const sISO = String(startDate.value);
    const eISO = String(endDate.value);
    const start = new Date(sISO + "T00:00:00Z"); const end = new Date(eISO + "T00:00:00Z");

    if (!amount || amount <= 0) throw new Error("Jumlah investasi harus lebih dari 0.");
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error("Tanggal tidak valid.");
    if (start > end) throw new Error("Tanggal mulai tidak boleh melebihi tanggal akhir.");

    const klines = await fetchAllBinanceDaily(start.getTime(), (new Date(end.getTime() + 24*3600*1000)).getTime());
    if (!klines.length) throw new Error("Gagal memuat data harga BTC.");
    const priceByDate = new Map(); klines.forEach(k => priceByDate.set(k.date, k.close));

    let fxMap = null; lastFXFallback = false;
    if (amtCur === "IDR" || dispCur === "IDR") {
      fxMap = await buildUsdIdrTimeseries(yyyyMmDd(start), yyyyMmDd(end));
      if (!fxMap || fxMap.size === 0) throw new Error("Gagal memuat kurs USD/IDR.");
      if (fxMap.__fallback_single) lastFXFallback = true;
    }

    const schedule = generateSchedule(start, end, freq);
    const buys = [];
    for (const d of schedule) {
      const key = yyyyMmDd(d);
      const priceUSD = closestPrior(priceByDate, key);
      if (typeof priceUSD !== "number") continue;

      let usdSpent = 0, idrSpent = 0;
      if (amtCur === "USD") { usdSpent = amount; idrSpent = fxMap ? amount * (closestPrior(fxMap, key) || 0) : 0; }
      else { idrSpent = amount; const rate = closestPrior(fxMap, key); if (typeof rate !== "number") continue; usdSpent = idrSpent / rate; }

      const btcBought = usdSpent / priceUSD;
      buys.push({ date: key, priceUSD, usdSpent, idrSpent, btcBought });
    }
    if (!buys.length) throw new Error("Tidak ada transaksi pada rentang waktu tersebut.");

    const firstDate = buys[0].date;
    const allDays = klines.map(k => k.date).filter(d => d >= firstDate && d <= yyyyMmDd(end));

    let cumBTC = 0;
    let cumUSD = 0;
    let cumIDRfromUSD = 0;
    let cumIDR = 0;

    const buyMap = new Map(); for (const b of buys) buyMap.set(b.date, b);

    const seriesDates = [], seriesValue = [], seriesBTC = [];
    valueSelByDate = new Map(); costSelByDate = new Map();
    for (const day of allDays) {
      const price = priceByDate.get(day);
      if (buyMap.has(day)) {
        const b = buyMap.get(day);
        cumBTC += b.btcBought;
        cumUSD += b.usdSpent;
        if (fxMap) {
          const rate = closestPrior(fxMap, b.date);
          if (amtCur === "USD") cumIDRfromUSD += b.usdSpent * (rate || 0);
          else cumIDR += b.idrSpent;
        }
      }
      const rateDay = fxMap ? closestPrior(fxMap, day) : undefined;
      const portfolioUSD = cumBTC * price;
      let valueSel = portfolioUSD;
      let costSel = cumUSD;
      if (dispCur === "IDR") {
        valueSel = portfolioUSD * (rateDay || 0);
        costSel = (amtCur === "USD") ? cumIDRfromUSD : cumIDR;
      }

      valueSelByDate.set(day, valueSel);
      costSelByDate.set(day, costSel);

      seriesDates.push(day);
      seriesValue.push(valueSel);
      seriesBTC.push(price);
    }

    const lastValue = seriesValue[seriesValue.length - 1];
    const lastCost = costSelByDate.get(seriesDates[seriesDates.length - 1]) || 0;
    const pnl = lastValue - lastCost; const pnlPct = lastCost > 0 ? (pnl / lastCost) * 100 : 0;
    const totalBTC = buys.reduce((s, b) => s + b.btcBought, 0);
    const lastPrice = priceByDate.get(seriesDates[seriesDates.length - 1]);

    const fmt = dispCur === "IDR" ? IDR : USD;
    kpiValue.textContent = fmt(lastValue);
    kpiCost.textContent = fmt(lastCost);
    kpiPnL.textContent = `${fmt(pnl)} (${pnlPct.toFixed(2)}%)`;
    kpiPnL.classList.toggle("text-emerald-500", pnl >= 0);
    kpiPnL.classList.toggle("text-red-500", pnl < 0);
    kpiBTC.textContent = `${fmtBTC.format(totalBTC)} BTC`;
    kpiLastPrice.textContent = USD(lastPrice);

    lastBuys = buys;
    renderBuysTable(buys, amtCur);
    renderFullBuysTable(buys);
    renderChart(seriesDates, seriesValue, seriesBTC, dispCur);

    if (lastFXFallback && (amtCur === "IDR" || dispCur === "IDR")) {
      showError("Peringatan: kurs IDR menggunakan nilai terbaru untuk semua hari (fallback).");
    }
  } catch (e) {
    console.error(e); showError(e.message || "Terjadi kesalahan.");
  } finally { setLoading(false); }
}

// ---------- Table & Chart ----------
function renderBuysTable(buys, amtCur) {
  buysTbody.innerHTML = "";
  const preview = buys.slice(0, 8);
  for (const b of preview) {
    const tr = document.createElement("tr");
    tr.className = "odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-800/60";
    const spentStr = amtCur === "USD" ? USD(b.usdSpent) : IDR(b.idrSpent);
    const cumCost = costSelByDate.get(b.date) || 0;
    const cumValue = valueSelByDate.get(b.date) || 0;
    const fmt = (dispCurrency === "IDR") ? IDR : USD;
    tr.innerHTML = `
      <td class="p-2 font-mono text-[12px]">${b.date}</td>
      <td class="p-2">${USD(b.priceUSD)}</td>
      <td class="p-2">${spentStr}</td>
      <td class="p-2">${fmtBTC.format(b.btcBought)}</td>
      <td class="p-2">${fmt(cumCost)}</td>
      <td class="p-2">${fmt(cumValue)}</td>`;
    buysTbody.appendChild(tr);
  }
}

function keyValueForSort(b) {
  if (sortKey === "cumCost") return Number(costSelByDate.get(b.date) || 0);
  if (sortKey === "cumValue") return Number(valueSelByDate.get(b.date) || 0);
  return (sortKey === "date") ? b.date : Number(b[sortKey]);
}

function sortBuys(arr) {
  const sorted = [...arr];
  sorted.sort((a,b) => {
    const va = keyValueForSort(a); const vb = keyValueForSort(b);
    let res = 0;
    if (sortKey === "date") res = va < vb ? -1 : va > vb ? 1 : 0;
    else res = Number(va) - Number(vb);
    return sortDir === "asc" ? res : -res;
  });
  return sorted;
}

function renderFullBuysTable(buys) {
  const q = (filterInput.value || "").toLowerCase();
  const filtered = sortBuys(buys).filter(b => {
    const cumCost = costSelByDate.get(b.date) || 0;
    const cumValue = valueSelByDate.get(b.date) || 0;
    return (`${b.date} ${b.priceUSD} ${b.usdSpent} ${b.idrSpent} ${b.btcBought} ${cumCost} ${cumValue}`).toLowerCase().includes(q);
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(total, startIdx + pageSize);

  buysTbodyFull.innerHTML = "";
  const fmt = (dispCurrency === "IDR") ? IDR : USD;
  for (let i=startIdx; i<endIdx; i++) {
    const b = filtered[i];
    const tr = document.createElement("tr");
    tr.className = "odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-800/60";
    const cumCost = costSelByDate.get(b.date) || 0;
    const cumValue = valueSelByDate.get(b.date) || 0;
    tr.innerHTML = `
      <td class="p-2 font-mono text-[12px]">${b.date}</td>
      <td class="p-2">${USD(b.priceUSD)}</td>
      <td class="p-2">${USD(b.usdSpent)}</td>
      <td class="p-2">${IDR(b.idrSpent)}</td>
      <td class="p-2">${fmtBTC.format(b.btcBought)}</td>
      <td class="p-2">${fmt(cumCost)}</td>
      <td class="p-2">${fmt(cumValue)}</td>`;
    buysTbodyFull.appendChild(tr);
  }
  pageInfo.textContent = `Menampilkan ${startIdx+1}–${endIdx} dari ${total} (Hal ${currentPage} / ${totalPages})`;

  // update header sort indicators (safe for responsive)
  fullTable.querySelectorAll("th[data-sort]").forEach(th => {
    const key = th.getAttribute("data-sort");
    const base = th.textContent.replace(" ▲","").replace(" ▼","");
    th.textContent = base + (key===sortKey ? (sortDir==="asc" ? " ▲" : " ▼") : "");
  });
}

function renderChart(labels, valueSeries, btcSeries, dispCur) {
  if (chartInstance) chartInstance.destroy();
  const zoomPlugin = window["chartjs-plugin-zoom"]; if (zoomPlugin) Chart.register(zoomPlugin);
  const fmtY = (v) => {
    if (dispCur === "IDR") {
      if (v >= 1_000_000_000_000) return (v/1_000_000_000_000).toFixed(1) + "T";
      if (v >= 1_000_000_000) return (v/1_000_000_000).toFixed(1) + "B";
      if (v >= 1_000_000) return (v/1_000_000).toFixed(1) + "M";
      if (v >= 1_000) return (v/1_000).toFixed(1) + "K";
      return v;
    } else {
      if (v >= 1_000_000_000) return (v/1_000_000_000).toFixed(1) + "B";
      if (v >= 1_000_000) return (v/1_000_000).toFixed(1) + "M";
      if (v >= 1_000) return (v/1_000).toFixed(1) + "k";
      return v;
    }
  };

  chartInstance = new Chart(chartCanvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Nilai Portofolio", data: valueSeries, borderWidth: 2, pointRadius: 0, tension: 0.15, yAxisID: "ySel" },
        { label: "Harga BTC (USD)", data: btcSeries, borderWidth: 1.5, pointRadius: 0, tension: 0.15, yAxisID: "yBTC" }
      ],
    },
    options: {
      maintainAspectRatio: false, responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: { callbacks: {
          label: (ctx) => {
            const id = ctx.dataset.yAxisID;
            const val = ctx.parsed.y;
            if (id === "ySel") return ctx.dataset.label + ": " + (dispCur === "IDR" ? IDR(val) : USD(val));
            if (id === "yBTC") return ctx.dataset.label + ": " + USD(val);
            return val;
          }
        } },
        zoom: { pan: { enabled: true, mode: "x" }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
        ySel: { type: "linear", position: "left", ticks: { callback: fmtY } },
        yBTC: { type: "linear", position: "right", grid: { drawOnChartArea: false } }
      }
    }
  });
}

// ---------- CSV ----------
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
function exportBuysCSV() {
  if (!lastBuys.length) return;
  const rows = [["Date","Price USD","Spent USD","Spent IDR","BTC Bought","Cumulative Cost (disp)","Portfolio Value (disp)"]];
  for (const b of lastBuys) {
    rows.push([
      b.date, String(b.priceUSD), String(b.usdSpent), String(b.idrSpent), String(b.btcBought),
      String(costSelByDate.get(b.date) || 0), String(valueSelByDate.get(b.date) || 0)
    ]);
  }
  downloadCSV("dca-buys.csv", rows);
}

// ---------- Presets ----------
function applyPreset(key) {
  const end = new Date();
  let start = new Date();
  if (key === "ytd") { start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1)); }
  else if (key === "1y") { start.setUTCFullYear(end.getUTCFullYear() - 1); }
  else if (key === "3y") { start.setUTCFullYear(end.getUTCFullYear() - 3); }
  else if (key === "5y") { start.setUTCFullYear(end.getUTCFullYear() - 5); }
  else if (key === "all") { start = new Date(Date.UTC(2017, 7, 17)); }
  startDate.value = yyyyMmDd(start); endDate.value = yyyyMmDd(end);
  clampDates();
}
presetButtons.forEach(btn => btn.addEventListener("click", (e) => {
  const key = e.currentTarget.getAttribute("data-preset");
  applyPreset(key);
  runSimulation();
}));

// ---------- Modal logic ----------
function openModal() {
  renderFullBuysTable(lastBuys);
  modalOverlay.classList.add("show");
  modalPanel.classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  modalOverlay.classList.remove("show");
  modalPanel.classList.remove("show");
  document.body.style.overflow = "";
}
transactionsCard.addEventListener("click", openModal);
modalOverlay.addEventListener("click", closeModal);
modalClose.addEventListener("click", closeModal);

filterInput.addEventListener("input", () => renderFullBuysTable(lastBuys));
firstPageBtn.addEventListener("click", () => { currentPage=1; renderFullBuysTable(lastBuys); });
prevPageBtn.addEventListener("click", () => { currentPage=Math.max(1,currentPage-1); renderFullBuysTable(lastBuys); });
nextPageBtn.addEventListener("click", () => { currentPage=currentPage+1; renderFullBuysTable(lastBuys); });
lastPageBtn.addEventListener("click", () => {
  const total = lastBuys.length; const totalPages = Math.max(1, Math.ceil(total/pageSize));
  currentPage = totalPages; renderFullBuysTable(lastBuys);
});
fullTable.querySelectorAll("th[data-sort]").forEach(th => th.addEventListener("click", () => {
  const key = th.getAttribute("data-sort");
  if (sortKey === key) sortDir = (sortDir==="asc"?"desc":"asc"); else { sortKey=key; sortDir="asc"; }
  currentPage=1; renderFullBuysTable(lastBuys);
}));
modalExport.addEventListener("click", exportBuysCSV);
cardExportBtn.addEventListener("click", (e) => { e.stopPropagation(); exportBuysCSV(); });

// ---------- Events ----------
runBtn.addEventListener("click", runSimulation);
exportCsvBtn.addEventListener("click", exportBuysCSV);
themeBtn.addEventListener("click", () => { toggleTheme(); });

// Chart zoom buttons
zoomInBtn.addEventListener("click", () => { if (chartInstance && chartInstance.zoom) chartInstance.zoom(1.2); });
zoomOutBtn.addEventListener("click", () => { if (chartInstance && chartInstance.zoom) chartInstance.zoom(0.8); });
resetZoomBtn.addEventListener("click", () => { if (chartInstance && chartInstance.resetZoom) chartInstance.resetZoom(); });

// ---------- Init ----------
window.addEventListener("load", () => { runSimulation(); });
