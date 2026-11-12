import type { CSSProperties } from "react";

export type IconName = "overview" | "transfer" | "activity" | "lab" | "wallet" | "account" | "arrow" | "swap" | "check" | "close" | "copy" | "logout" | "shield" | "chevron" | "clock" | "info" | "code" | "refresh" | "mail" | "external" | "eye";

const paths: Record<IconName, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></>,
  transfer: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></>,
  activity: <><path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4"/></>,
  lab: <><path d="M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1.1 2h13.8a1.3 1.3 0 0 0 1.1-2L14 9V3M8 14h8"/></>,
  wallet: <><path d="M20 8V5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h15V8H5a1.5 1.5 0 0 1 0-3M20 12h-5v5h5M16 14.5h.1"/></>,
  account: <><path d="m3 9 9-6 9 6H3ZM5 12v6m7-6v6m7-6v6M3 21h18"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  swap: <><path d="M7 20V4m-4 4 4-4 4 4M17 4v16m-4-4 4 4 4-4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  logout: <><path d="M9 4H4v16h5M11 12h10m-4-4 4 4-4 4"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/></>,
  refresh: <><path d="M20 10a8 8 0 1 0-1 8M20 4v6h-6"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
};

export function Icon({ name, size = 20, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
