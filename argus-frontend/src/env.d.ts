/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Base URL of the argus-worker. Defaults to "" (same-origin). */
	readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
