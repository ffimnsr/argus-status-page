import "./styles.css";

// ---------------------------------------------------------------------------
// Config — worker base URL injected at build time via VITE_WORKER_URL.
// Defaults to "" so relative paths work when served from the same origin.
// ---------------------------------------------------------------------------
const WORKER_URL: string = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? "";

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
		| {
				total: number;
				up_count: number;
				uptime_pct: number;
				avg_response_ms: number | null;
		  }
		| null
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
	if (mins === 1) return "1 minute ago";
	if (mins < 60) return `${mins} minutes ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs === 1) return "1 hour ago";
	return `${hrs} hours ago`;
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
	if (total === 0) return "—";
	return `${((up / total) * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// SVG icons (inline, no external dependency)
// ---------------------------------------------------------------------------

const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
  <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" />
</svg>`;

const ICON_ALERT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
  <path fill-rule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clip-rule="evenodd" />
</svg>`;

const ICON_SETTINGS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
  <path fill-rule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.923-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z" clip-rule="evenodd" />
</svg>`;

// ---------------------------------------------------------------------------
// Uptime bar histogram — 90 small square tiles
// ---------------------------------------------------------------------------

function renderUptimeBars(monitorId: string, days: HistoryDay[]): string {
	const bars = days
		.map(({ date, monitors }) => {
			const d = monitors[monitorId];
			if (!d || d.total === 0) {
				return `<span
          title="${escapeHtml(date)}: No data"
          style="background:var(--color-surface-container-high)"
          class="flex-1 rounded-sm h-4 cursor-default min-w-0"></span>`;
			}
			const pct = d.uptime_pct;
			const bg =
				pct >= 99
					? "var(--color-primary-container)"
					: pct >= 90
						? "var(--color-secondary-container)"
						: "var(--color-tertiary-container)";
			const label = `${escapeHtml(date)}: ${pct}% uptime${d.avg_response_ms !== null ? ` · ${d.avg_response_ms}ms avg` : ""}`;
			return `<span
        title="${label}"
        style="background:${bg}"
        class="flex-1 rounded-sm h-4 cursor-default min-w-0 hover:opacity-75 transition-opacity"></span>`;
		})
		.join("");

	return `<div class="flex gap-px mt-5">${bars}</div>`;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function operationalBadge(up: boolean): string {
	if (up) {
		return `<span class="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase"
        style="color:var(--color-primary)">
        <span class="pulse-glow inline-block w-2 h-2 rounded-full flex-shrink-0"
              style="background:var(--color-primary)"></span>
        Operational
      </span>`;
	}
	return `<span class="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase"
      style="color:var(--color-tertiary)">
      <span class="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style="background:var(--color-tertiary)"></span>
      Outage
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
	const allUp = config.monitors.every((m) => status.monitors[m.id]?.up !== false);
	const historyDays = history.history_days;

	// ---- Nav ----------------------------------------------------------------
	const nav = `
    <nav class="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto w-full">
      <span class="text-lg font-bold tracking-tight" style="font-family:var(--font-display);color:var(--color-on-surface)">
        ${escapeHtml(config.title)}
      </span>
      <button
        type="button"
        aria-label="Settings"
        class="p-2 rounded-full transition-colors"
        style="color:var(--color-on-surface-variant)"
        onmouseover="this.style.background='var(--color-surface-container-high)'"
        onmouseout="this.style.background=''"
      >
        ${ICON_SETTINGS}
      </button>
    </nav>`;

	// ---- Overall status banner ----------------------------------------------
	const banner = allUp
		? `<div class="rounded-xl px-6 py-5 flex items-center gap-4 border-l-4"
          style="background:var(--color-surface-container);border-color:var(--color-primary)">
        <span class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
              style="background:color-mix(in srgb,var(--color-primary) 18%,transparent);color:var(--color-primary)">
          ${ICON_CHECK}
        </span>
        <div>
          <h1 class="text-2xl font-bold leading-tight" style="font-family:var(--font-display);color:var(--color-on-surface)">
            All Systems Operational
          </h1>
          <p class="text-sm mt-0.5" style="color:var(--color-on-surface-variant)">
            Status updated ${escapeHtml(timeAgo(status.last_checked))}. Our engineers are constantly monitoring all services.
          </p>
        </div>
      </div>`
		: `<div class="rounded-xl px-6 py-5 flex items-center gap-4 border-l-4"
          style="background:var(--color-surface-container);border-color:var(--color-tertiary-container)">
        <span class="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
              style="background:color-mix(in srgb,var(--color-tertiary) 18%,transparent);color:var(--color-tertiary)">
          ${ICON_ALERT}
        </span>
        <div>
          <h1 class="text-2xl font-bold leading-tight" style="font-family:var(--font-display);color:var(--color-on-surface)">
            Some Systems Degraded
          </h1>
          <p class="text-sm mt-0.5" style="color:var(--color-on-surface-variant)">
            Status updated ${escapeHtml(timeAgo(status.last_checked))}. Our team is actively investigating.
          </p>
        </div>
      </div>`;

	// ---- Service cards ------------------------------------------------------
	const cards = config.monitors
		.map((m) => {
			const cur = status.monitors[m.id];
			const up = cur?.up ?? false;
			const uptime = overallUptime(m.id, history.days);

			return `
      <div class="rounded-xl px-6 py-5" style="background:var(--color-surface-container-low)">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="font-semibold text-base truncate" style="font-family:var(--font-display);color:var(--color-on-surface)">
              ${escapeHtml(m.name)}
            </h3>
            ${
							m.description
								? `<p class="text-sm mt-0.5 truncate" style="color:var(--color-on-surface-variant)">${escapeHtml(m.description)}</p>`
								: ""
						}
          </div>
          <div class="flex-shrink-0 pt-0.5">
            ${operationalBadge(up)}
          </div>
        </div>

        ${
					!up && cur?.reason
						? `<p class="mt-3 text-xs rounded-lg px-3 py-2"
               style="color:var(--color-tertiary);background:color-mix(in srgb,var(--color-tertiary-container) 20%,transparent)">
               ${escapeHtml(cur.reason)}
             </p>`
						: ""
				}

        ${renderUptimeBars(m.id, history.days)}

        <div class="flex items-center justify-between mt-2">
          <span class="text-xs" style="color:var(--color-on-surface-variant)">${historyDays} days ago</span>
          <span class="text-xs font-semibold" style="color:var(--color-on-surface)">${uptime} Uptime</span>
          <span class="text-xs" style="color:var(--color-on-surface-variant)">Today</span>
        </div>
      </div>`;
		})
		.join("");

	// ---- Footer -------------------------------------------------------------
	const footer = `
    <footer class="text-center text-xs py-8" style="color:var(--color-outline)">
      <p>Argus Status Page &nbsp;·&nbsp; Powered by
        <a href="https://pages.cloudflare.com" target="_blank" rel="noopener noreferrer"
           class="hover:underline transition-colors" style="color:var(--color-on-surface-variant)">
          Cloudflare Pages
        </a>
        &nbsp;&amp;&nbsp;
        <a href="https://workers.cloudflare.com" target="_blank" rel="noopener noreferrer"
           class="hover:underline transition-colors" style="color:var(--color-on-surface-variant)">
          Cloudflare Workers
        </a>
      </p>
      <p class="mt-1">© ${new Date().getFullYear()} ${escapeHtml(config.title)} &nbsp;·&nbsp; Auto-refreshes every 60s</p>
    </footer>`;

	// ---- Assemble -----------------------------------------------------------
	const html = `
    <div class="min-h-screen" style="background:var(--color-background)">
      ${nav}
      <main class="max-w-4xl mx-auto px-6 pb-16 space-y-4">
        ${banner}
        <section class="space-y-3 pt-2">
          ${cards}
        </section>
      </main>
      ${footer}
    </div>`;

	const app = document.getElementById("app");
	if (!app) return;
	app.innerHTML = html;

	document.title = config.title;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function renderLoading(): void {
	const skeletonCard = `
    <div class="rounded-xl px-6 py-5 space-y-4" style="background:var(--color-surface-container-low)">
      <div class="flex items-start justify-between gap-4">
        <div class="space-y-2 flex-1">
          <div class="shimmer h-4 w-1/3 rounded-md"></div>
          <div class="shimmer h-3 w-1/2 rounded-md"></div>
        </div>
        <div class="shimmer h-4 w-20 rounded-md flex-shrink-0"></div>
      </div>
      <div class="shimmer h-4 w-full rounded-sm mt-5"></div>
      <div class="flex justify-between">
        <div class="shimmer h-3 w-16 rounded-md"></div>
        <div class="shimmer h-3 w-20 rounded-md"></div>
        <div class="shimmer h-3 w-12 rounded-md"></div>
      </div>
    </div>`;

	const app = document.getElementById("app");
	if (!app) return;
	app.innerHTML = `
    <div class="min-h-screen" style="background:var(--color-background)">
      <nav class="flex items-center justify-between px-6 py-4 max-w-4xl mx-auto">
        <span class="text-lg font-bold tracking-tight" style="font-family:var(--font-display);color:var(--color-on-surface)">
          StatusPage
        </span>
      </nav>
      <main class="max-w-4xl mx-auto px-6 pb-16 space-y-4">
        <div class="shimmer rounded-xl h-24 w-full"></div>
        <section class="space-y-3 pt-2">
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
    <div class="min-h-screen flex items-center justify-center" style="background:var(--color-background)">
      <div class="max-w-md w-full mx-6 rounded-xl px-6 py-5"
           style="background:color-mix(in srgb,var(--color-tertiary-container) 15%,transparent);border:1px solid color-mix(in srgb,var(--color-tertiary) 25%,transparent)">
        <p class="font-semibold" style="font-family:var(--font-display);color:var(--color-tertiary)">
          Failed to load status data
        </p>
        <p class="text-sm mt-1" style="color:var(--color-on-surface-variant)">
          ${escapeHtml(msg)}
        </p>
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
