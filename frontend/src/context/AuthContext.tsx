"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import Cookies from "js-cookie";
import api from "@/lib/axios";

interface AuthUser {
  username: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = Cookies.get("zeus_token");
    if (token) {
      api.get("/api/auth/me")
        .then((res) => setUser({ username: res.data.username, role: res.data.role }))
        .catch(() => {
          Cookies.remove("zeus_token");
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.post("/api/auth/login", { username, password });
    Cookies.set("zeus_token", res.data.access_token, { expires: 1 });
    setUser({ username: res.data.username, role: res.data.role });
  };

  const logout = () => {
    Cookies.remove("zeus_token");
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
