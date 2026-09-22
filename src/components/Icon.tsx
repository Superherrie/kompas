// Small stroke icon set (24px grid) — keeps the bundle free of an icon library.
const PATHS: Record<string, string> = {
  today: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M5.6 18.4L7 17m10-10l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  layers: 'M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zm8 3a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  upload: 'M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zm8 3l2-1-2-4-2 1a7 7 0 00-2-1l-.5-2h-5L10 7a7 7 0 00-2 1l-2-1-2 4 2 1a7 7 0 000 2l-2 1 2 4 2-1a7 7 0 002 1l.5 2h5l.5-2a7 7 0 002-1l2 1 2-4-2-1a7 7 0 000-2z',
  briefcase: 'M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-11 0h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1zm-1 6h18',
  more: 'M5 12h.01M12 12h.01M19 12h.01M5 6h.01M12 6h.01M19 6h.01M5 18h.01M12 18h.01M19 18h.01',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', close: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4-4', clock: 'M12 7v5l3 2m-3-11a9 9 0 100 18 9 9 0 000-18z',
  out: 'M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4m-4-4h11',
}

export default function Icon({ name, size = 20, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#12332e" /><circle cx="32" cy="32" r="19" fill="none" stroke="#a9c4b3" strokeWidth="2.5" />
      <path d="M32 14l6 18-6 18-6-18z" fill="#f6f1e7" /><path d="M32 14l6 18H26z" fill="#e0694a" /><circle cx="32" cy="32" r="2.6" fill="#12332e" />
    </svg>
  )
}
