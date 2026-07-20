import { Link, useLocation } from "react-router-dom";

/**
 * Sub-navigation for the Domains section: Domains and its Email accounts sub-page share one
 * sidebar entry (`/…/domains`) and switch via these in-page tabs. Role prefix (`/admin` vs
 * `/manager`) is derived from the current path so the same component serves both shells.
 */
export function DomainsSectionTabs() {
  const { pathname } = useLocation();
  const prefix = pathname.startsWith("/manager") ? "/manager" : "/admin";
  const onEmailAccounts = pathname.endsWith("/email-accounts");
  const tabs = [
    { label: "Domains", to: `${prefix}/domains`, active: !onEmailAccounts },
    { label: "Email accounts", to: `${prefix}/domains/email-accounts`, active: onEmailAccounts },
  ];
  return (
    <div className="flex w-fit gap-1 rounded-full border border-border bg-black/20 p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={tab.active ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-sm transition ${
            tab.active ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
