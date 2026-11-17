/** Types for scripts/notices.mjs (used by electron.vite.config.ts and its unit test). */
export declare const PACKAGES: readonly string[];
export declare const NOTICES_FILE: string;
export declare function renderNotices(): string;
export declare function listedPackages(notices: string): Map<string, string>;
