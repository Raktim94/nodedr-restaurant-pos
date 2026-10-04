"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useTwoFactorActions, useTwoFactorStatus } from "@/hooks/use-two-factor";
import { ApiError } from "@/lib/api";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

export default function SecurityPage() {
  const { data: status, isLoading } = useTwoFactorStatus();
  const { setup, enable, disable } = useTwoFactorActions();
  const [pending, setPending] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Protect your account</p>
      </div>
      <SettingsTabs />

      <Card className="flex max-w-xl flex-col gap-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Two-factor authentication</h2>
          <p className="text-sm text-muted-foreground">
            Ask for a code from an authenticator app (Google Authenticator, Authy, 1Password…) every time you sign in
            with your password. PIN quick-login is turned off for your account while this is on.
          </p>
        </div>

        {isLoading ? (
          <Skeleton className="h-10" />
        ) : recoveryCodes ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Two-factor authentication is on.</p>
            <p className="text-sm text-muted-foreground">
              Save these recovery codes somewhere safe. Each works once if you lose your phone. They won&rsquo;t be
              shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-4 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n")).then(() => toast.success("Copied"))}>
                Copy
              </Button>
              <Button size="sm" onClick={() => setRecoveryCodes(null)}>I&rsquo;ve saved them</Button>
            </div>
          </div>
        ) : status?.enabled ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">
              On · {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left
            </p>
            {!confirmingDisable ? (
              <div>
                <Button variant="outline" onClick={() => setConfirmingDisable(true)}>Turn off</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="pw">Your password</Label>
                  <Input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dc">Current code or a recovery code</Label>
                  <Input id="dc" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={!password || !disableCode || disable.isPending}
                    onClick={() =>
                      disable.mutate(
                        { password, code: disableCode },
                        {
                          onSuccess: () => {
                            toast.success("Two-factor authentication turned off");
                            setConfirmingDisable(false);
                            setPassword("");
                            setDisableCode("");
                          },
                          onError: (e) => toast.error(errMsg(e)),
                        },
                      )
                    }
                  >
                    Turn off
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmingDisable(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        ) : pending ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Scan this with your authenticator app, then enter the 6-digit code it shows.
            </p>
            <div className="w-fit rounded-xl bg-white p-3">
              <QRCodeSVG value={pending.otpauthUrl} size={168} />
            </div>
            <p className="text-xs text-muted-foreground">
              Can&rsquo;t scan? Enter this key manually: <span className="select-all font-mono text-foreground">{pending.secret}</span>
            </p>
            <div className="flex gap-2">
              <Input className="w-40" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button
                disabled={code.trim().length !== 6 || enable.isPending}
                onClick={() =>
                  enable.mutate(code.trim(), {
                    onSuccess: (r) => {
                      setRecoveryCodes(r.recoveryCodes);
                      setPending(null);
                      setCode("");
                    },
                    onError: (e) => toast.error(errMsg(e)),
                  })
                }
              >
                Turn on
              </Button>
              <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button disabled={setup.isPending} onClick={() => setup.mutate(undefined, { onSuccess: setPending, onError: (e) => toast.error(errMsg(e)) })}>
              Set up
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
