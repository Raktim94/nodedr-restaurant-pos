"use client";

import { loginSchema, type LoginDto } from "@nodedr-restaurant/types";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AlertCircle } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-auth";
import { useDemoInfo } from "@/hooks/use-demo";
import { ApiError } from "@/lib/api";
import { formResolver } from "@/lib/form-validation";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";

export default function LoginPage() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const login = useLogin();
  const { data: demo } = useDemoInfo();
  // Set once the server says this account uses two-factor authentication.
  const [needsCode, setNeedsCode] = useState(false);
  // Shown inline under the form (a toast vanishes before it can be read).
  const [error, setError] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginDto>({ resolver: formResolver(loginSchema) });

  const onSubmit = (dto: LoginDto) => {
    setError(null);
    login.mutate(dto, {
      onSuccess: (data) => {
        // A delivery rider has no back-office screens: open their deliveries.
        const user = (data as { user?: { roleName?: string; permissions?: string[] } }).user;
        const rider = user?.roleName === "DELIVERY_STAFF" && user.permissions?.includes("delivery.rider");
        router.push(rider ? "/my-deliveries" : "/dashboard");
      },
      onError: (err) => {
        if (err instanceof ApiError && err.message === "TWO_FACTOR_REQUIRED") {
          setNeedsCode(true);
          return;
        }
        if (err instanceof ApiError && err.status >= 500) {
          setError("login.serverError");
        } else if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("login.connectionError");
        }
      },
    });
  };

  return (
    <main lang={LOCALE_TAGS[locale]} className="relative flex flex-1 items-center justify-center overflow-hidden bg-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_90%),transparent)]"
      />
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <Link href="/">
            <Logo size={44} />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            OrderRestro
          </h1>
          <p className="text-sm text-muted-foreground">{t("login.title")}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("login.identifier")}</Label>
            <Input
              id="email"
              type="text"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              autoFocus
              className="h-11"
              placeholder={t("login.identifierHint")}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
            {errors.email && (
              <p id="email-error" className="text-xs text-destructive">{t("login.invalidIdentifier")}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("signup.password")}</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              enterKeyHint="go"
              className="h-11"
              placeholder={t("login.passwordHint")}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              {...register("password")}
            />
            {errors.password && (
              <p id="password-error" className="text-xs text-destructive">{t("login.invalidPassword")}</p>
            )}
          </div>

          {needsCode && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="totp">{t("login.verificationCode")}</Label>
              <Input
                id="totp"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                placeholder={t("login.codeHint")}
                aria-invalid={!!errors.totp}
                aria-describedby={errors.totp ? "totp-help totp-error" : "totp-help"}
                {...register("totp")}
              />
              <p id="totp-help" className="text-xs text-muted-foreground">
                {t("login.codeHelp")}
              </p>
              {errors.totp && <p id="totp-error" className="text-xs text-destructive">{t("login.invalidCode")}</p>}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t(error)}</span>
            </div>
          )}

          <Button type="submit" className="mt-2 h-12 text-base" disabled={login.isPending}>
            {login.isPending ? t("login.signingIn") : t("signup.signIn")}
          </Button>
          {demo?.demo && (
            <Link href="/demo" className="inline-flex h-12 items-center justify-center rounded-lg border border-border text-base font-medium hover:bg-muted">{t("login.demo")}</Link>
          )}
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          {t("login.newRestaurant")}{" "}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            {t("signup.create")}
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
