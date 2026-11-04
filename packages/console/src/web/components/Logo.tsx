/** The Not Today mark: an unimpressed face on the ink tile. Decorative: the name next to it carries the meaning. */
export function Logo({ size }: { size: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path d="M6.6 12.6h8a4 4 0 0 1-8 0zM17.4 12.6h8a4 4 0 0 1-8 0z" fill="var(--ink-text)" />
      <circle cx="13" cy="14.1" r="1.6" fill="var(--ink)" />
      <circle cx="23.8" cy="14.1" r="1.6" fill="var(--ink)" />
      <path d="M12.2 22.4l8.2-1" stroke="var(--brand)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
