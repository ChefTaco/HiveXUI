import Link, { usePathname } from "@security/navigation";

const TABS = ["Overview", "Cases", "Events", "Entities", "Sources", "Evidence", "Policies", "Audit"] as const;

/** Section tabs for the security product. */
export function FusionNav({ labEnabled = false }: { labEnabled?: boolean }): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav aria-label="Security Fusion" className="tabs">
      {[...TABS, ...(labEnabled ? ["Lab"] : [])].map((label, i) => {
        const href = `/security-fusion${i ? "/" + label.toLowerCase() : ""}`;
        const active = i === 0 ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={label} href={href} aria-current={active ? "page" : undefined} className={active ? "tab tab--active" : "tab"}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
