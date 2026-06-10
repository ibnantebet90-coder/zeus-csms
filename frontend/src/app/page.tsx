"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Tunggu AuthProvider selesai validasi token ke backend dulu
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [user, loading, router]);

  // Tampilkan spinner selama auth masih loading
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );
}