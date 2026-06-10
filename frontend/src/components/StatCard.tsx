import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  color: "emerald" | "blue" | "amber" | "purple" | "red";
  trend?: { value: number; label: string };
}

const colorMap = {
  emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  blue:    "bg-blue-500/10 border-blue-500/20 text-blue-400",
  amber:   "bg-amber-500/10 border-amber-500/20 text-amber-400",
  purple:  "bg-purple-500/10 border-purple-500/20 text-purple-400",
  red:     "bg-red-500/10 border-red-500/20 text-red-400",
};

export default function StatCard({ title, value, subtitle, icon: Icon, color, trend }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <p className="text-sm text-gray-400">{title}</p>
        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      {trend && (
        <p className={`text-xs mt-2 ${trend.value >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}% {trend.label}
        </p>
      )}
    </div>
  );
}
