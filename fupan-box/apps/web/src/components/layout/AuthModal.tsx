"use client";

import { useState } from "react";
import { LogIn, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";

export function AuthModal() {
  const open = useUIStore((s) => s.authModalOpen);
  const close = useUIStore((s) => s.closeAuthModal);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const resetForm = () => {
    setUsername("");
    setEmail("");
    setPassword("");
    setErr("");
    setSubmitting(false);
  };

  const onClose = () => {
    close();
    resetForm();
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setErr("");
    const u = username.trim();
    const p = password.trim();
    const e = email.trim();
    if (!u || !p) {
      setErr("请先填写用户名和密码");
      return;
    }
    if (mode === "register" && !e) {
      setErr("注册需要填写邮箱");
      return;
    }
    try {
      setSubmitting(true);
      if (mode === "register") {
        await api.register(u, e, p);
      } else {
        await api.login(u, p);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("app:auth-changed"));
      }
      onClose();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[80]"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={onClose}
      />
      <div
        className="fixed z-[81]"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 380,
          maxWidth: "92vw",
        }}
      >
        <div
          className="rounded-xl"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--border-color)" }}
          >
            <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {mode === "login" ? "登录" : "注册"}
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded transition-opacity hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>

          <div className="p-4 space-y-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
            />
            {mode === "register" && (
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱"
                type="email"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
              />
            )}
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              type="password"
              onKeyDown={(e) => e.key === "Enter" && void handleSubmit()}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
            />

            {err && <p className="text-xs" style={{ color: "var(--accent-red)" }}>{err}</p>}

            <button
              onClick={() => void handleSubmit()}
              className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              disabled={submitting}
              style={{
                background: "var(--accent-purple)",
                color: "white",
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting
                ? "提交中..."
                : mode === "login"
                  ? <><LogIn size={14} />登录</>
                  : <><UserPlus size={14} />注册并登录</>}
            </button>

            <button
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="w-full py-1.5 text-xs text-center"
              style={{ color: "var(--text-muted)" }}
            >
              {mode === "login" ? "没有账号？点击注册" : "已有账号？点击登录"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
