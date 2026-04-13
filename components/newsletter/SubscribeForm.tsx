"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { Mail, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SubscribeFormProps {
  /** Render a compact version (for footer) */
  compact?: boolean;
}

export function SubscribeForm({ compact = false }: SubscribeFormProps) {
  const t = useTranslations("newsletter");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "already" | "invalid" | "error"
  >("idle");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus("invalid");
      return;
    }

    startTransition(async () => {
      setStatus("loading");
      try {
        const res = await fetch("/api/subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ email: trimmed, locale }),
        });

        const data = await res.json();

        if (res.ok) {
          setStatus("success");
          setEmail("");
        } else if (data.error === "already_subscribed") {
          setStatus("already");
        } else if (data.error === "invalid_email") {
          setStatus("invalid");
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    });
  };

  const message =
    status === "success"
      ? t("success")
      : status === "already"
        ? t("alreadySubscribed")
        : status === "invalid"
          ? t("invalid")
          : status === "error"
            ? t("error")
            : null;

  const isError =
    status === "invalid" || status === "error" || status === "already";
  const isLoading = status === "loading" || isPending;

  if (compact) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
          {t("title")}
        </h3>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status !== "idle" && status !== "loading") setStatus("idle");
            }}
            placeholder={t("placeholder")}
            disabled={isLoading}
            aria-invalid={isError || undefined}
            className="flex-1 h-8 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            disabled={isLoading}
            className="h-8 px-3 text-xs"
          >
            {isLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Mail className="size-3" />
            )}
          </Button>
        </form>
        {message && (
          <p
            className={`mt-2 text-xs flex items-center gap-1 ${
              status === "success"
                ? "text-green-500"
                : isError
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {status === "success" ? (
              <CheckCircle2 className="size-3 flex-shrink-0" />
            ) : (
              <AlertCircle className="size-3 flex-shrink-0" />
            )}
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="border border-border bg-card rounded-xl p-8 md:p-12 text-center">
      <div className="max-w-lg mx-auto">
        <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 border border-primary/20 mb-4">
          <Mail className="size-6 text-primary" />
        </div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">{t("description")}</p>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status !== "idle" && status !== "loading") setStatus("idle");
            }}
            placeholder={t("placeholder")}
            disabled={isLoading}
            aria-invalid={isError || undefined}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading} className="sm:w-auto">
            {isLoading && <Loader2 className="size-4 animate-spin" />}
            {t("subscribe")}
          </Button>
        </form>
        {message && (
          <p
            className={`mt-4 text-sm flex items-center justify-center gap-1.5 ${
              status === "success"
                ? "text-green-500"
                : isError
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {status === "success" ? (
              <CheckCircle2 className="size-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="size-4 flex-shrink-0" />
            )}
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
