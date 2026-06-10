"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, BatteryCharging, Users, Receipt,
  Bell, LogOut, Settings, Map, Activity, TrendingUp,
  BarChart3, Terminal, FileBarChart2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/charge-points", icon: BatteryCharging, label: "Charge Points" },
  { href: "/dashboard/map", icon: Map, label: "Peta Lokasi" },
  { href: "/dashboard/customers", icon: Users, label: "Customers" },
  { href: "/dashboard/transactions", icon: Receipt, label: "Transaksi" },
  { href: "/dashboard/report", icon: FileBarChart2, label: "Laporan" },
  { href: "/dashboard/alerts", icon: Bell, label: "Alerts" },
  { href: "/dashboard/energy", icon: BarChart3, label: "Energi" },
  { href: "/dashboard/forecasting", icon: TrendingUp, label: "Forecasting" },
  { href: "/dashboard/monitor", icon: Activity, label: "Monitor RT" },
  { href: "/dashboard/settings", icon: Settings, label: "Pengaturan" },
  { href: "/dashboard/commands", icon: Terminal, label: "Remote Command" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 bg-gray-900/95 backdrop-blur-sm border-r border-gray-800 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-800 flex items-center gap-3">
        <div className="w-9 h-9 relative flex-shrink-0">
          <Image src="/zeus-logo.png" alt="ZEUS" fill className="object-contain" />
        </div>
        <div>
          <p className="text-sm font-bold text-white leading-none">ZEUS CSMS</p>
          <p className="text-xs text-gray-500 mt-0.5">v0.3</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${active
                ? "bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20"
                : "text-gray-400 hover:text-white hover:bg-gray-800/70 border border-transparent"
                }`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-gray-800">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs font-medium text-white truncate">{user?.username}</p>
          <p className="text-xs text-gray-500">{user?.role}</p>
        </div>
        <button onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors border border-transparent">
          <LogOut className="w-4 h-4" />
          Keluar
        </button>
      </div>
    </aside>
  );
}
