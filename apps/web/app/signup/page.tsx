"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterDto } from "@nodedr-restaurant/types";
import { motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useRegister } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n/context";
import { ApiError } from "@/lib/api";

// The browser and the server can ship different ICU currency names and time zone lists.
const RegionalFields = dynamic(() => import("./regional-fields").then(module => module.RegionalFields), { ssr: false });

export default function SignupPage() {
  const { t } = useI18n();
  const router = useRouter();
  const register = useRegister();
  const { note, clear, toast } = useNoteToast();
  const prefersReducedMotion = useReducedMotion();
  const form = useForm<RegisterDto>({
    resolver: zodResolver(registerSchema),
    defaultValues: { regionalSettings: { country: "", currency: "", timezone: "", taxRegime: "CUSTOM" } },
  });
  const {
    register: field,
    handleSubmit,
    formState: { errors },
  } = form;

  const onSubmit = (dto: RegisterDto) => {
    register.mutate(dto, {
      onSuccess: () => router.push("/dashboard"),
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : t("signup.failed"));
      },
    });
  };

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_90%),transparent)]"
      />
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Link href="/">
            <Logo size={44} />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            OrderRestro
          </h1>
          <p className="text-sm text-muted-foreground">{t("signup.title")}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="restaurantName">{t("signup.restaurant")}</Label>
            <Input
              id="restaurantName"
              autoComplete="organization"
              {...field("restaurantName")}
            />
            {errors.restaurantName && (
              <p className="text-xs text-destructive">{errors.restaurantName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="branchName">{t("signup.branch")}</Label>
            <Input
              id="branchName"
              placeholder="Main Branch"
              defaultValue="Main Branch"
              {...field("branchName")}
            />
            {errors.branchName && (
              <p className="text-xs text-destructive">{errors.branchName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ownerName">{t("signup.owner")}</Label>
            <Input
              id="ownerName"
              autoComplete="name"
              {...field("ownerName")}
            />
            {errors.ownerName && (
              <p className="text-xs text-destructive">{errors.ownerName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("signup.email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@restaurant.com"
              {...field("email")}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("signup.password")}</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder={t("signup.passwordHint")}
              {...field("password")}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          <RegionalFields form={form} />

          <StatusNote note={note} onClear={clear} />
          <Button type="submit" className="mt-2 h-11" disabled={register.isPending}>
            {register.isPending ? t("signup.creating") : t("signup.create")}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          {t("signup.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            {t("signup.signIn")}
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
