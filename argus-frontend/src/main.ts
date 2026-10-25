import "./styles.css";

// ---------------------------------------------------------------------------
// Config — worker base URL injected at build time via VITE_WORKER_URL.
// Defaults to "" so relative paths work when served from the same origin.
// ---------------------------------------------------------------------------
const WORKER_URL: string =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ?? "";

// ---------------------------------------------------------------------------
// Types (mirrors argus-worker API response shapes)
// ---------------------------------------------------------------------------

interface MonitorInfo {
  id: string;
  name: string;
  description: string;
  type: "http" | "websocket";
  url: string;
}

interface MonitorCurrentStatus {
  name: string;
  type: string;
  up: boolean;
  response_ms: number | null;
  status_code: number | null;
  reason: string | null;
  checked_at: string;
}

interface StatusResponse {
  last_checked: string | null;
  monitors: Record<string, MonitorCurrentStatus>;
}

interface HistoryDay {
  date: string;
  monitors: Record<
    string,
    {
      total: number;
      up_count: number;
      uptime_pct: number;
      avg_response_ms: number | null;
    } | null
  >;
}

interface HistoryResponse {
  history_days: number;
  days: HistoryDay[];
}

interface ConfigResponse {
  title: string;
  description: string;
  monitors: MonitorInfo[];
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`);
  if (!res.ok) throw new Error(`API ${path} responded with ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1m ago";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return "1h ago";
  return `${hrs}h ago`;
}

function getFormattedUtc(): string {
  const now = new Date();
  return now.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

// ---------------------------------------------------------------------------
// Overall uptime calculation across all available history days
// ---------------------------------------------------------------------------

function overallUptime(monitorId: string, days: HistoryDay[]): string {
  let total = 0;
  let up = 0;
  for (const day of days) {
    const d = day.monitors[monitorId];
    if (d && d.total > 0) {
      total += d.total;
      up += d.up_count;
    }
  }
  if (total === 0) return "100.00%";
  return `${((up / total) * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// SVG Cyber Icons
// ---------------------------------------------------------------------------

const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter" class="w-6 h-6">
  <path d="M20 6L9 17l-5-5" />
</svg>`;

const ICON_ALERT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter" class="w-6 h-6">
  <path d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 18c-.77 1.333.192 3 1.732 3z" />
</svg>`;

const ICON_TERMINAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" class="w-5 h-5">
  <polyline points="4 17 10 11 4 5"></polyline>
  <line x1="12" y1="19" x2="20" y2="19"></line>
</svg>`;

// ---------------------------------------------------------------------------
// Cyber Uptime bar histogram — square tiles with glowing cyber colors
// ---------------------------------------------------------------------------

function renderUptimeBars(monitorId: string, days: HistoryDay[]): string {
  const bars = days
    .map(({ date, monitors }) => {
      const d = monitors[monitorId];
      if (!d || d.total === 0) {
        return `<span
          title="${escapeHtml(date)}: No data"
          class="flex-1 h-5 cursor-default min-w-0 transition-all rounded-none"
          style="background: #0d1522; border: 1px solid rgba(0,240,255,0.08);"></span>`;
      }
      const pct = d.uptime_pct;
      let bg = "var(--color-success)";
      let shadow = "0 0 4px rgba(0, 255, 136, 0.4)";
      if (pct < 90) {
        bg = "var(--color-error)";
        shadow = "0 0 4px rgba(255, 0, 60, 0.5)";
      } else if (pct < 99) {
        bg = "var(--color-tertiary)";
        shadow = "0 0 4px rgba(255, 230, 0, 0.5)";
      }

      const label = `${escapeHtml(date)}: ${pct}% uptime${d.avg_response_ms !== null ? ` · ${d.avg_response_ms}ms avg` : ""}`;
      return `<span
        title="${label}"
        class="flex-1 h-5 cursor-default min-w-0 hover:scale-125 hover:z-10 transition-all rounded-none"
        style="background:${bg}; box-shadow: ${shadow}; border: 1px solid rgba(0,0,0,0.4)"></span>`;
    })
    .join("");

  return `<div class="flex gap-1 mt-4 p-1.5 bg-[#080d16] border border-[#162235]">${bars}</div>`;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function operationalBadge(up: boolean): string {
  if (up) {
    return `<span class="inline-flex items-center gap-2 px-2.5 py-1 bg-[#00ff88]/10 border border-[#00ff88]/40 text-[#00ff88] text-xs font-mono font-bold tracking-wider uppercase text-glow-success">
        <span class="pulse-glow-green inline-block w-2 h-2 bg-[#00ff88] flex-shrink-0"></span>
        [ OPERATIONAL ]
      </span>`;
  }
  return `<span class="inline-flex items-center gap-2 px-2.5 py-1 bg-[#ff003c]/10 border border-[#ff003c]/40 text-[#ff003c] text-xs font-mono font-bold tracking-wider uppercase text-glow-error">
      <span class="pulse-glow-red inline-block w-2 h-2 bg-[#ff003c] flex-shrink-0"></span>
      [ OUTAGE ]
    </span>`;
}

// ---------------------------------------------------------------------------
// Render full page
// ---------------------------------------------------------------------------

function renderApp(
  config: ConfigResponse,
  status: StatusResponse,
  history: HistoryResponse,
): void {
  const allUp = config.monitors.every(
    (m) => status.monitors[m.id]?.up !== false,
  );
  const historyDays = history.history_days;

  // ---- Nav ----------------------------------------------------------------
  const nav = `
    <header class="border-b border-[#00f0ff]/20 bg-[#07090e]/90 backdrop-blur sticky top-0 z-40">
      <div class="flex items-center justify-between px-6 py-3.5 max-w-5xl mx-auto w-full">
        <div class="flex items-center gap-3">
          <div class="w-3 h-3 bg-[#00f0ff] animate-pulse" style="box-shadow: 0 0 10px #00f0ff"></div>
          <div>
            <div class="text-[#00f0ff] font-mono text-xs font-semibold tracking-widest uppercase text-glow-primary">
              // SYS_MONITOR v2.0
            </div>
            <h1 class="text-xl font-bold tracking-wider font-display uppercase text-[#e0f7fc]">
              ${escapeHtml(config.title)}
            </h1>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="hidden sm:flex items-center gap-2 text-xs font-mono text-[#7d9bb2] bg-[#0c111a] px-3 py-1.5 border border-[#00f0ff]/20">
            <span class="text-[#00f0ff]">TIME:</span>
            <span>${getFormattedUtc()}</span>
          </div>
          <button
            type="button"
            aria-label="Terminal"
            class="p-2 border border-[#00f0ff]/30 text-[#00f0ff] bg-[#00f0ff]/5 hover:bg-[#00f0ff]/20 hover:border-[#00f0ff] transition-all"
          >
            ${ICON_TERMINAL}
          </button>
        </div>
      </div>
    </header>`;

  // ---- Overall status banner ----------------------------------------------
  const banner = allUp
    ? `<div class="cyber-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-l-4 border-l-[#00ff88]">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 flex items-center justify-center bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/40 flex-shrink-0"
               style="box-shadow: 0 0 15px rgba(0, 255, 136, 0.2)">
            ${ICON_CHECK}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono text-[#00ff88] uppercase tracking-widest font-semibold">[ STATUS: NORMAL ]</span>
            </div>
            <h2 class="text-xl font-bold font-display uppercase tracking-wide text-[#e0f7fc] text-glow-success mt-0.5">
              ALL SYSTEMS OPERATIONAL
            </h2>
            <p class="text-xs font-mono text-[#7d9bb2] mt-1">
              SYS_CHECK: PASSED &nbsp;·&nbsp; LAST_SCAN: ${escapeHtml(timeAgo(status.last_checked))} &nbsp;·&nbsp; ALL NODES HEALTHY
            </p>
          </div>
        </div>
        <div class="text-right hidden sm:block">
          <div class="text-xs font-mono text-[#7d9bb2]">GLOBAL UPTIME</div>
          <div class="text-2xl font-bold font-mono text-[#00ff88] text-glow-success">100.0%</div>
        </div>
      </div>`
    : `<div class="cyber-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-l-4 border-l-[#ff003c]">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 flex items-center justify-center bg-[#ff003c]/10 text-[#ff003c] border border-[#ff003c]/40 flex-shrink-0"
               style="box-shadow: 0 0 15px rgba(255, 0, 60, 0.2)">
            ${ICON_ALERT}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono text-[#ff003c] uppercase tracking-widest font-semibold">[ STATUS: DEGRADED ]</span>
            </div>
            <h2 class="text-xl font-bold font-display uppercase tracking-wide text-[#e0f7fc] text-glow-error mt-0.5">
              SYSTEM DEGRADATION DETECTED
            </h2>
            <p class="text-xs font-mono text-[#7d9bb2] mt-1">
              ALERT: INCIDENT ACTIVE &nbsp;·&nbsp; LAST_SCAN: ${escapeHtml(timeAgo(status.last_checked))} &nbsp;·&nbsp; ENGINEERS NOTIFIED
            </p>
          </div>
        </div>
      </div>`;

  // ---- Service cards ------------------------------------------------------
  const cards = config.monitors
    .map((m) => {
      const cur = status.monitors[m.id];
      const up = cur?.up ?? false;
      const uptime = overallUptime(m.id, history.days);
      const latency =
        cur?.response_ms !== null && cur?.response_ms !== undefined
          ? `${cur.response_ms}ms`
          : "—";
      const statusCode = cur?.status_code
        ? `HTTP ${cur.status_code}`
        : m.type.toUpperCase();

      return `
      <div class="cyber-card p-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#00f0ff]/10 pb-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-mono uppercase px-2 py-0.5 bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff]">
                ${statusCode}
              </span>
              <h3 class="font-display font-bold text-lg text-[#e0f7fc] tracking-wide">
                ${escapeHtml(m.name)}
              </h3>
            </div>
            ${
              m.description
                ? `<p class="text-xs font-mono text-[#7d9bb2] mt-1">${escapeHtml(m.description)}</p>`
                : ""
            }
          </div>
          <div class="flex items-center gap-4 self-start sm:self-center">
            <div class="text-right hidden md:block">
              <div class="text-[10px] font-mono text-[#7d9bb2]">LATENCY</div>
              <div class="text-xs font-mono font-semibold text-[#00f0ff]">${latency}</div>
            </div>
            <div>
              ${operationalBadge(up)}
            </div>
          </div>
        </div>

        ${
          !up && cur?.reason
            ? `<div class="mt-3 text-xs font-mono p-3 bg-[#ff003c]/10 border border-[#ff003c]/30 text-[#ff003c]">
               [ ERROR_LOG ]: ${escapeHtml(cur.reason)}
             </div>`
            : ""
        }

        ${renderUptimeBars(m.id, history.days)}

        <div class="flex items-center justify-between mt-3 font-mono text-[11px] text-[#7d9bb2]">
          <span>${historyDays} DAYS AGO</span>
          <span class="text-[#00f0ff] font-semibold">${uptime} UPTIME</span>
          <span>PRESENT</span>
        </div>
      </div>`;
    })
    .join("");

  // ---- Footer -------------------------------------------------------------
  const footer = `
    <footer class="mt-12 border-t border-[#00f0ff]/20 py-8 text-center font-mono text-xs text-[#7d9bb2]">
      <div class="max-w-5xl mx-auto px-6 space-y-2">
        <p>
          <span class="text-[#00f0ff]">// ARGUS STATUS PAGE</span> &nbsp;·&nbsp; POWERED BY
          <a href="https://pages.cloudflare.com" target="_blank" rel="noopener noreferrer"
             class="text-[#e0f7fc] hover:text-[#00f0ff] underline decoration-[#00f0ff]/40 transition-colors">
            CLOUDFLARE_PAGES
          </a>
          &amp;
          <a href="https://workers.cloudflare.com" target="_blank" rel="noopener noreferrer"
             class="text-[#e0f7fc] hover:text-[#00f0ff] underline decoration-[#00f0ff]/40 transition-colors">
            CLOUDFLARE_WORKERS
          </a>
        </p>
        <p class="text-[11px] opacity-70">
          © ${new Date().getFullYear()} ${escapeHtml(config.title)} &nbsp;·&nbsp; AUTO_REFRESH: 60s
        </p>
      </div>
    </footer>`;

  // ---- Assemble -----------------------------------------------------------
  const html = `
    <div class="scanlines"></div>
    <div class="min-h-screen flex flex-col">
      ${nav}
      <main class="max-w-5xl mx-auto px-6 pt-8 pb-16 space-y-6 flex-1 w-full">
        ${banner}
        <section class="space-y-4">
          <div class="flex items-center justify-between border-b border-[#00f0ff]/20 pb-2">
            <h3 class="font-display font-bold text-sm uppercase tracking-widest text-[#00f0ff]">
              // MONITORED_SERVICES [ ${config.monitors.length} ]
            </h3>
            <span class="text-xs font-mono text-[#7d9bb2]">REFRESH_INTERVAL: 60s</span>
          </div>
          ${cards}
        </section>
      </main>
      ${footer}
    </div>`;

  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = html;

  document.title = `[ ARGUS ] ${config.title}`;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function renderLoading(): void {
  const skeletonCard = `
    <div class="cyber-card p-6 space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-2 flex-1">
          <div class="shimmer h-5 w-1/3"></div>
          <div class="shimmer h-3 w-1/2"></div>
        </div>
        <div class="shimmer h-6 w-24 flex-shrink-0"></div>
      </div>
      <div class="shimmer h-6 w-full mt-4"></div>
      <div class="flex justify-between">
        <div class="shimmer h-3 w-16"></div>
        <div class="shimmer h-3 w-20"></div>
        <div class="shimmer h-3 w-12"></div>
      </div>
    </div>`;

  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `
    <div class="scanlines"></div>
    <div class="min-h-screen flex flex-col">
      <header class="border-b border-[#00f0ff]/20 bg-[#07090e] py-4 px-6">
        <div class="max-w-5xl mx-auto flex justify-between items-center">
          <span class="font-display font-bold text-lg text-[#00f0ff] uppercase tracking-wider">// ARGUS // STATUS_LOADING...</span>
        </div>
      </header>
      <main class="max-w-5xl mx-auto px-6 py-8 space-y-6 flex-1 w-full">
        <div class="shimmer h-28 w-full border border-[#00f0ff]/20"></div>
        <section class="space-y-4">
          ${[0, 1, 2].map(() => skeletonCard).join("")}
        </section>
      </main>
    </div>`;
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function renderError(msg: string): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `
    <div class="scanlines"></div>
    <div class="min-h-screen flex items-center justify-center p-6">
      <div class="cyber-card max-w-lg w-full p-6 border-l-4 border-l-[#ff003c]">
        <div class="flex items-center gap-3 text-[#ff003c]">
          ${ICON_ALERT}
          <h3 class="font-display font-bold text-lg uppercase tracking-wider text-glow-error">
            [ SYSTEM CONNECTION ERROR ]
          </h3>
        </div>
        <p class="text-xs font-mono text-[#7d9bb2] mt-3">
          CRITICAL: Unable to synchronize telemetry from Argus Worker endpoint.
        </p>
        <div class="mt-4 p-3 bg-[#ff003c]/10 border border-[#ff003c]/30 text-xs font-mono text-[#ff003c]">
          DETAILS: ${escapeHtml(msg)}
        </div>
        <button onclick="window.location.reload()"
                class="mt-5 w-full py-2.5 bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 border border-[#00f0ff] text-[#00f0ff] font-mono text-xs uppercase font-bold tracking-wider transition-all">
          [ RECONNECT TO MATRIX ]
        </button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------

async function load(): Promise<void> {
  try {
    const [config, status, history] = await Promise.all([
      apiFetch<ConfigResponse>("/api/config"),
      apiFetch<StatusResponse>("/api/status"),
      apiFetch<HistoryResponse>("/api/history"),
    ]);
    renderApp(config, status, history);
  } catch (err: unknown) {
    renderError(err instanceof Error ? err.message : String(err));
  }
}

renderLoading();
load();

// Auto-refresh every 60 seconds
setInterval(() => {
  load();
}, 60_000);
