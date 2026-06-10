"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { RefreshCw } from "lucide-react";

function generateCaptcha() {
  const ops = ["+", "-", "×"];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a: number, b: number, answer: number;
  if (op === "+") {
    a = Math.floor(Math.random() * 9) + 1;
    b = Math.floor(Math.random() * 9) + 1;
    answer = a + b;
  } else if (op === "-") {
    a = Math.floor(Math.random() * 9) + 3;
    b = Math.floor(Math.random() * (a - 1)) + 1;
    answer = a - b;
  } else {
    a = Math.floor(Math.random() * 5) + 1;
    b = Math.floor(Math.random() * 5) + 1;
    answer = a * b;
  }
  return { question: `${a} ${op} ${b}`, answer };
}

const BG_IMAGES = ["/bg-1.jpg", "/bg-2.jpg", "/bg-3.jpg", "/bg-4.jpg"];

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captcha, setCaptcha] = useState({ question: "1 + 1", answer: 2 });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [captchaError, setCaptchaError] = useState(false);
  const [bgIndex, setBgIndex] = useState<number | null>(null);

  useEffect(() => {
    setCaptcha(generateCaptcha());
    setBgIndex(Math.floor(Math.random() * BG_IMAGES.length));
  }, []);

  // Jika sudah login (misal buka /login langsung), redirect ke dashboard
  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [user, loading, router]);

  const refreshCaptcha = () => {
    setCaptcha(generateCaptcha());
    setCaptchaInput("");
    setCaptchaError(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCaptchaError(false);

    if (parseInt(captchaInput) !== captcha.answer) {
      setCaptchaError(true);
      refreshCaptcha();
      return;
    }

    setSubmitting(true);
    try {
      await login(username, password);
      // Setelah login(), AuthContext set user → useEffect di atas yang handle redirect
      router.replace("/dashboard");
    } catch {
      setError("Username atau password salah.");
      refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  // Jangan render form jika auth masih loading (hindari flash form saat sudah login)
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0 z-0 bg-gray-950">
        {bgIndex !== null && (
          <Image
            src={BG_IMAGES[bgIndex]}
            alt="background"
            fill
            className="object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gray-950/85" />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-gray-950/50" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm">
        {/* Logo + Title */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-32 h-32 mb-4 relative">
            <Image
              src="/zeus-logo.png"
              alt="ZEUS Logo"
              fill
              priority
              className="object-contain drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]"
            />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">ZEUS CSMS</h1>
          <p className="text-sm text-gray-400 mt-1">Charging Station Management System</p>
        </div>

        {/* Form Card */}
        <div className="bg-gray-900/80 backdrop-blur-md border border-gray-700/50 rounded-2xl p-6 space-y-4 shadow-2xl">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Masukkan username"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Masukkan password"
              required
            />
          </div>

          {/* Captcha */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Captcha</label>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-800/80 border border-gray-700 rounded-lg px-4 py-2.5 flex items-center justify-between">
                <span className="text-base font-bold text-white tracking-widest select-none font-mono">
                  {captcha.question} = ?
                </span>
                <button
                  type="button"
                  onClick={refreshCaptcha}
                  title="Ganti soal"
                  className="text-gray-500 hover:text-emerald-400 transition-colors ml-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="number"
                value={captchaInput}
                onChange={e => { setCaptchaInput(e.target.value); setCaptchaError(false); }}
                className={`w-20 bg-gray-800/80 border rounded-lg px-3 py-2.5 text-sm text-white text-center focus:outline-none transition-colors ${captchaError ? "border-red-500" : "border-gray-700 focus:border-emerald-500"
                  }`}
                placeholder="?"
                required
              />
            </div>
            {captchaError && (
              <p className="text-xs text-red-400 mt-1.5">Jawaban salah, coba lagi</p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            onClick={handleSubmit}
            disabled={submitting || !captchaInput}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
          >
            {submitting && <RefreshCw className="w-4 h-4 animate-spin" />}
            {submitting ? "Memproses..." : "Masuk"}
          </button>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          ZEUS CSMS v0.3 · Powered by OCPP 1.6
        </p>
      </div>
    </div>
  );
}