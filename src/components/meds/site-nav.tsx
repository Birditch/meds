"use client";

import { CalendarClockIcon, FileDownIcon, PillIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV: { href: "/" | "/visits" | "/reports"; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "药品", icon: PillIcon },
  { href: "/visits", label: "就诊 · 住院", icon: CalendarClockIcon },
  { href: "/reports", label: "导出清单", icon: FileDownIcon },
];

const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

/** The top navigation: one page per job instead of everything on one screen. */
export function SiteNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className={cn("-mb-px flex overflow-x-auto", className)}>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm transition-colors",
              active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
