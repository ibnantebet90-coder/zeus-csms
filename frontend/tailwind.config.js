/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/context/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        "plug-in": {
          "0%": { transform: "translateX(-6px) rotate(-8deg)", opacity: "0.4" },
          "60%": { transform: "translateX(1px) rotate(2deg)", opacity: "1" },
          "100%": { transform: "translateX(0) rotate(0deg)", opacity: "1" },
        },
        "energy-flow": {
          "0%": { strokeDashoffset: "24" },
          "100%": { strokeDashoffset: "0" },
        },
        "energy-flow-fast": {
          "0%": { strokeDashoffset: "20" },
          "100%": { strokeDashoffset: "0" },
        },
        "battery-fill": {
          "0%, 100%": { height: "20%" },
          "50%": { height: "85%" },
        },
        "status-glow": {
          "0%, 100%": { opacity: "1", filter: "drop-shadow(0 0 2px currentColor)" },
          "50%": { opacity: "0.55", filter: "drop-shadow(0 0 8px currentColor)" },
        },
        "spark-pop": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.25)", opacity: "0.6" },
        },
        "hud-scan": {
          "0%": { transform: "translateY(-100%)", opacity: "0" },
          "10%": { opacity: "1" },
          "90%": { opacity: "1" },
          "100%": { transform: "translateY(100%)", opacity: "0" },
        },
        "border-glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 6px 0 var(--tw-shadow-color), inset 0 0 12px -8px var(--tw-shadow-color)" },
          "50%": { boxShadow: "0 0 22px 2px var(--tw-shadow-color), inset 0 0 18px -6px var(--tw-shadow-color)" },
        },
        "ring-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "counter-tick": {
          "0%": { transform: "translateY(2px)", opacity: "0.4" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "grid-drift": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "40px 40px" },
        },
        "blink-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.2" },
        },
      },
      animation: {
        "plug-in": "plug-in 0.5s ease-out",
        "energy-flow": "energy-flow 1s linear infinite",
        "energy-flow-fast": "energy-flow-fast 0.5s linear infinite",
        "battery-fill": "battery-fill 2.8s ease-in-out infinite",
        "status-glow": "status-glow 2s ease-in-out infinite",
        "spark-pop": "spark-pop 1.4s ease-in-out infinite",
        "hud-scan": "hud-scan 3s ease-in-out infinite",
        "border-glow-pulse": "border-glow-pulse 2.2s ease-in-out infinite",
        "ring-spin": "ring-spin 6s linear infinite",
        "ring-spin-fast": "ring-spin 2.5s linear infinite",
        "counter-tick": "counter-tick 0.25s ease-out",
        "grid-drift": "grid-drift 3s linear infinite",
        "blink-dot": "blink-dot 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
