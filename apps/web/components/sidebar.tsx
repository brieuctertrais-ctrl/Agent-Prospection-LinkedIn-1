"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, BookOpen, GraduationCap, LogOut, Settings, Users, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { Badge } from "./ui/badge";

export function Sidebar({
  labels,
  newLeads,
  user,
}: {
  labels: Record<"personas" | "leads" | "autopilot" | "stats" | "knowledge" | "tuto" | "settings" | "logout" | "new", string>;
  newLeads: number;
  user: { name: string; email: string };
}) {
  const path = usePathname();
  const items = [
    { href: "/personas", label: labels.personas, icon: Users },
    { href: "/leads", label: labels.leads, icon: UserCheck, badge: newLeads > 0 },
    { href: "/autopilot", label: labels.autopilot, icon: Bot },
    { href: "/stats", label: labels.stats, icon: BarChart3 },
    { href: "/knowledge", label: labels.knowledge, icon: BookOpen },
    { href: "/tuto", label: labels.tuto, icon: GraduationCap },
  ];
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-navy-dark px-4 py-6">
      <div className="mb-10 px-2">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1">
        {items.map(({ href, label, icon: Icon, badge }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              path.startsWith(href) ? "bg-navy-light text-white" : "text-slate-400 hover:bg-navy-light/60 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {badge && <Badge className="ml-auto">{labels.new}</Badge>}
          </Link>
        ))}
      </nav>
      <div className="mt-6 border-t border-white/5 pt-4">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2 hover:bg-navy-light">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold font-bold text-navy">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-slate-500">{user.email}</span>
            </span>
          </summary>
          <div className="mt-2 space-y-1 pl-2">
            <Link href="/settings" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300 hover:bg-navy-light">
              <Settings className="h-4 w-4" /> {labels.settings}
            </Link>
            <form action="/auth/signout" method="post">
              <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300 hover:bg-navy-light">
                <LogOut className="h-4 w-4" /> {labels.logout}
              </button>
            </form>
          </div>
        </details>
      </div>
    </aside>
  );
}
