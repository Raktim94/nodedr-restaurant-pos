"use client";

import { Building2, ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import {
  RESTAURANT_NAME_MAX_LENGTH,
  TAX_REGIME_PRESETS,
  TAX_REGIMES,
  type TaxMode,
  type TaxRegime,
} from "@nodedr-restaurant/types";
import { KioskCard } from "@/components/settings/kiosk-card";
import { MobileAppCard } from "@/components/settings/mobile-app-card";
import { PrinterDiagnosticsCard } from "@/components/settings/printer-diagnostics-card";
import { BluetoothPrinterCard } from "@/components/settings/bluetooth-printer-card";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useBranch } from "@/hooks/use-branch";
import { useNotificationMute } from "@/hooks/use-notification-mute";
import {
  useSettings,
  useUpdateBranchSettings,
  useUpdateRestaurantSettings,
  useUploadRestaurantLogo,
  type BranchSettings,
  type RestaurantSettings,
} from "@/hooks/use-settings";
import { ApiError } from "@/lib/api";

export default function SettingsPage() {
  const { branchId } = useBranch();
  const { data, isLoading } = useSettings(branchId);

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-24 sm:pb-20 max-w-7xl">
      <div className="flex flex-col gap-1 pb-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Restaurant, branch, hardware, and staff configuration</p>
      </div>

      <SettingsTabs />

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <GeneralSettingsForm
          key={`${data.restaurant.id}-${data.branch.id}`}
          restaurant={data.restaurant}
          branch={data.branch}
          branchId={branchId}
        />
      )}

      {data && <OnlineOrdersCard key={data.branch.id} branchId={branchId} branch={data.branch} />}

      {data && <KioskCard key={`kiosk-${data.branch.id}`} branchId={branchId} branch={data.branch} />}

      <NotificationSettingsCard />

      <BluetoothPrinterCard />
      <PrinterDiagnosticsCard />
      <MobileAppCard />
    </div>
  );
}

function OnlineOrdersCard({
  branchId,
  branch,
}: {
  branchId: string | null;
  branch: { autoConfirmOrders: boolean; autoConfirmReservations: boolean };
}) {
  const update = useUpdateBranchSettings(branchId);
  const save = (dto: { autoConfirmOrders?: boolean; autoConfirmReservations?: boolean }) =>
    update.mutate(dto, {
      onSuccess: () => toast.success("Saved"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save"),
    });

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6 rounded-2xl border border-border/80 shadow-2xs">
      <div>
        <h2 className="text-base sm:text-lg font-bold text-foreground">Online orders &amp; table bookings</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Choose whether orders and bookings from your website are accepted automatically or wait for
          you to accept them. You can always cancel an order or booking from its window.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 p-3.5 sm:p-4 bg-muted/20">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="auto-confirm-orders" className="text-xs sm:text-sm font-semibold">Auto-confirm online orders</Label>
          <p className="text-xs text-muted-foreground">
            Off = each new order rings, then waits for you to Accept or Reject before it reaches the
            kitchen. On = sent to the kitchen straight away.
          </p>
        </div>
        <Switch
          id="auto-confirm-orders"
          checked={branch.autoConfirmOrders}
          disabled={update.isPending}
          onCheckedChange={(v) => save({ autoConfirmOrders: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 p-3.5 sm:p-4 bg-muted/20">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="auto-confirm-bookings" className="text-xs sm:text-sm font-semibold">Auto-confirm table bookings</Label>
          <p className="text-xs text-muted-foreground">
            Off = new bookings wait for you to Accept. On = confirmed automatically.
          </p>
        </div>
        <Switch
          id="auto-confirm-bookings"
          checked={branch.autoConfirmReservations}
          disabled={update.isPending}
          onCheckedChange={(v) => save({ autoConfirmReservations: v })}
        />
      </div>
    </Card>
  );
}

function NotificationSettingsCard() {
  const [muted, toggleMuted] = useNotificationMute();

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6 rounded-2xl border border-border/80 shadow-2xs">
      <div>
        <h2 className="text-base sm:text-lg font-bold text-foreground">Notifications</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          New orders, table reservations, and kitchen tickets on this device.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 p-3.5 sm:p-4 bg-muted/20">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="notification-sound" className="text-xs sm:text-sm font-semibold">Notification sound</Label>
          <p className="text-xs text-muted-foreground">
            Plays a chime for new orders, reservations, and kitchen display
            tickets. This only affects this device/browser — mute the
            kitchen display separately from the office if needed.
          </p>
        </div>
        <Switch
          id="notification-sound"
          checked={!muted}
          onCheckedChange={() => toggleMuted()}
        />
      </div>
    </Card>
  );
}

function GeneralSettingsForm({
  restaurant,
  branch,
  branchId,
}: {
  restaurant: RestaurantSettings;
  branch: BranchSettings;
  branchId: string | null;
}) {
  const [name, setName] = useState(restaurant.name);
  const [legalName, setLegalName] = useState(restaurant.legalName ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(restaurant.logoUrl);
  const [currency, setCurrency] = useState(restaurant.currency);
  const [timezone, setTimezone] = useState(restaurant.timezone);
  const [upiVpa, setUpiVpa] = useState(restaurant.upiVpa ?? "");
  const [upiPayeeName, setUpiPayeeName] = useState(restaurant.upiPayeeName ?? "");
  const [loyaltyPointValue, setLoyaltyPointValue] = useState(restaurant.loyaltyPointValue);
  const [loyaltyEarnPerCurrency, setLoyaltyEarnPerCurrency] = useState(
    String(restaurant.loyaltyEarnPerCurrency),
  );
  const [referralEnabled, setReferralEnabled] = useState(!!restaurant.referralEnabled);
  const [referralSharerPoints, setReferralSharerPoints] = useState(String(restaurant.referralSharerPoints ?? 15));
  const [referralReferredPoints, setReferralReferredPoints] = useState(String(restaurant.referralReferredPoints ?? 10));
  const [referralMinPurchase, setReferralMinPurchase] = useState(String(Number(restaurant.referralMinPurchase ?? 200)));
  const [onlineMinOrder, setOnlineMinOrder] = useState(String(Number(restaurant.onlineMinOrderAmount ?? 0)));
  const initialAdjust = Number(restaurant.onlinePriceAdjustValue ?? 0);
  const [adjustKind, setAdjustKind] = useState<"PERCENT" | "AMOUNT">(restaurant.onlinePriceAdjustKind ?? "PERCENT");
  const [adjustDir, setAdjustDir] = useState<"cheaper" | "costlier">(initialAdjust < 0 ? "cheaper" : "costlier");
  const [adjustValue, setAdjustValue] = useState(String(Math.abs(initialAdjust)));
  const [maxDiscount, setMaxDiscount] = useState(String(Number(restaurant.maxManualDiscountPercent ?? 100)));
  const [requireReason, setRequireReason] = useState(!!restaurant.requireDiscountReason);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const uploadLogo = useUploadRestaurantLogo();

  const [branchName, setBranchName] = useState(branch.name);
  const [address, setAddress] = useState(branch.address ?? "");
  const [phone, setPhone] = useState(branch.phone ?? "");
  const [gstNumber, setGstNumber] = useState(branch.gstNumber ?? "");
  const [country, setCountry] = useState(branch.country);
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(branch.taxRegime);
  const [taxMode, setTaxMode] = useState<TaxMode>(branch.taxMode);
  const [taxLabel, setTaxLabel] = useState(branch.taxLabel ?? "");
  const [taxId, setTaxId] = useState(branch.taxId ?? "");

  const preset = TAX_REGIME_PRESETS[taxRegime];

  const updateRestaurant = useUpdateRestaurantSettings(branchId);
  const { note: saveNote, clear: clearSaveNote, toast: saveToast } = useNoteToast();
  const updateBranch = useUpdateBranchSettings(branchId);

  const onSubmitRestaurant = (e: React.FormEvent) => {
    e.preventDefault();
    updateRestaurant.mutate(
      {
        name,
        legalName: legalName || undefined,
        logoUrl,
        currency,
        timezone,
        upiVpa: upiVpa.trim() || null,
        upiPayeeName: upiPayeeName.trim() || null,
        loyaltyPointValue: Number(loyaltyPointValue) || 0,
        loyaltyEarnPerCurrency: Number(loyaltyEarnPerCurrency) || 1,
        referralEnabled,
        referralSharerPoints: Math.max(Math.floor(Number(referralSharerPoints) || 0), 0),
        referralReferredPoints: Math.max(Math.floor(Number(referralReferredPoints) || 0), 0),
        referralMinPurchase: Math.max(Number(referralMinPurchase) || 0, 0),
        onlineMinOrderAmount: Math.max(Number(onlineMinOrder) || 0, 0),
        onlinePriceAdjustKind: adjustKind,
        onlinePriceAdjustValue: (adjustDir === "cheaper" ? -1 : 1) * Math.abs(Number(adjustValue) || 0),
        maxManualDiscountPercent: Math.min(Math.max(Number(maxDiscount) || 0, 0), 100),
        requireDiscountReason: requireReason,
      },
      {
        onSuccess: () => saveToast.success("Restaurant details saved"),
        onError: (err) => saveToast.error(err instanceof ApiError ? err.message : "Could not save"),
      },
    );
  };

  const onSubmitBranch = (e: React.FormEvent) => {
    e.preventDefault();
    updateBranch.mutate(
      {
        name: branchName,
        address: address || undefined,
        phone: phone || undefined,
        gstNumber: gstNumber || undefined,
        country,
        taxRegime,
        taxMode,
        taxLabel: taxLabel || null,
        taxId: taxId || null,
      },
      {
        onSuccess: () => toast.success("Branch details saved"),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save"),
      },
    );
  };

  const onRegimeChange = (value: TaxRegime | null) => {
    if (!value) return;
    setTaxRegime(value);
    // Switching regimes resets to that regime's own mode/country by
    // default — a picker that silently kept the old mode would quietly
    // mis-price every item on this branch (see settings.service.ts).
    setTaxMode(TAX_REGIME_PRESETS[value].defaultMode);
    setCountry(TAX_REGIME_PRESETS[value].defaultCountry);
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="flex flex-col gap-4 p-4 sm:p-6 rounded-2xl border border-border/80 shadow-2xs">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <ImagePlus className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-foreground">Restaurant Profile</h2>
            <p className="text-xs text-muted-foreground">Brand identity, loyalty, and website pricing defaults</p>
          </div>
        </div>

        <form onSubmit={onSubmitRestaurant} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold">Logo</Label>
            <div className="flex items-center gap-4">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  uploadLogo.mutate(file, {
                    onSuccess: (res) => setLogoUrl(res.url),
                    onError: (err) =>
                      toast.error(err instanceof ApiError ? err.message : "Could not upload logo"),
                  });
                }}
              />
              {logoUrl ? (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border bg-secondary shadow-2xs">
                  {/* eslint-disable-next-line @next/next/no-img-element -- uploaded asset served from the backend, not a Next-optimizable remote source */}
                  <img src={logoUrl} alt="" className="h-full w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => {
                      setLogoUrl(null);
                      if (logoInputRef.current) logoInputRef.current.value = "";
                    }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-xs"
                    aria-label="Remove logo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadLogo.isPending}
                  className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border/80 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[10px] font-semibold">
                    {uploadLogo.isPending ? "Uploading…" : "Upload"}
                  </span>
                </button>
              )}
              <p className="text-xs text-muted-foreground leading-relaxed">
                Shows in the app sidebar and login screen instead of the default mark.
                Square, at least 256×256px, PNG with transparent background recommended.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-name" className="text-xs font-semibold">Restaurant Name *</Label>
            <Input
              id="r-name"
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, RESTAURANT_NAME_MAX_LENGTH))}
              maxLength={RESTAURANT_NAME_MAX_LENGTH}
              required
            />
            <p className="text-right text-[11px] text-muted-foreground tabular-nums">
              {name.length}/{RESTAURANT_NAME_MAX_LENGTH}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-legal" className="text-xs font-semibold">Legal / Registered Name</Label>
            <Input 
              id="r-legal" 
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
              value={legalName} 
              onChange={(e) => setLegalName(e.target.value)} 
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-currency" className="text-xs font-semibold">Currency Code</Label>
              <Input
                id="r-currency"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium uppercase tabular-nums"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-timezone" className="text-xs font-semibold">Timezone</Label>
              <Input 
                id="r-timezone" 
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
                value={timezone} 
                onChange={(e) => setTimezone(e.target.value)} 
                required 
              />
            </div>
          </div>

          {/* Loyalty Program Section */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-border/70 p-3.5 sm:p-4 bg-muted/20">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-foreground">Loyalty Rewards Program</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure points earned and value redeemed during customer checkout.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="r-loyalty-earn" className="text-xs font-medium">Earn 1 point per</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">{currency}</span>
                  <Input
                    id="r-loyalty-earn"
                    type="number"
                    min="1"
                    step="1"
                    className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                    value={loyaltyEarnPerCurrency}
                    onChange={(e) => setLoyaltyEarnPerCurrency(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="r-loyalty-value" className="text-xs font-medium">1 point redeems for</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">{currency}</span>
                  <Input
                    id="r-loyalty-value"
                    type="number"
                    min="0"
                    step="0.01"
                    className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                    value={loyaltyPointValue}
                    onChange={(e) => setLoyaltyPointValue(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Referral Rewards */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-3.5 sm:p-4 bg-muted/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-foreground">Referral Rewards</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Points awarded to sharer and referee after first successful paid purchase.
                </p>
              </div>
              <Switch
                id="r-referral-enabled"
                aria-label="Enable referral rewards"
                checked={referralEnabled}
                onCheckedChange={setReferralEnabled}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="r-referral-sharer" className="text-xs font-medium">Sharer Points</Label>
                <Input
                  id="r-referral-sharer"
                  type="number"
                  min="0"
                  step="1"
                  disabled={!referralEnabled}
                  className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                  value={referralSharerPoints}
                  onChange={(e) => setReferralSharerPoints(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="r-referral-referred" className="text-xs font-medium">Referee Points</Label>
                <Input
                  id="r-referral-referred"
                  type="number"
                  min="0"
                  step="1"
                  disabled={!referralEnabled}
                  className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                  value={referralReferredPoints}
                  onChange={(e) => setReferralReferredPoints(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-referral-min" className="text-xs font-medium">First order min purchase ({currency})</Label>
              <Input
                id="r-referral-min"
                type="number"
                min="0"
                step="1"
                disabled={!referralEnabled}
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                value={referralMinPurchase}
                onChange={(e) => setReferralMinPurchase(e.target.value)}
              />
            </div>
          </div>

          {/* Website Food Pricing Adjustment */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-3.5 sm:p-4 bg-muted/20">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-foreground">Website Food Prices</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Price variance for online ordering menu items (in-store POS prices remain untouched).
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="r-adjust-dir" className="text-xs font-medium">Direction</Label>
                <select
                  id="r-adjust-dir"
                  className="h-11 sm:h-9 rounded-xl border border-input bg-background px-3 text-xs sm:text-sm font-medium"
                  value={adjustDir}
                  onChange={(e) => setAdjustDir(e.target.value as "cheaper" | "costlier")}
                >
                  <option value="cheaper">Cheaper</option>
                  <option value="costlier">Costlier</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="r-adjust-kind" className="text-xs font-medium">Adjustment Type</Label>
                <select
                  id="r-adjust-kind"
                  className="h-11 sm:h-9 rounded-xl border border-input bg-background px-3 text-xs sm:text-sm font-medium"
                  value={adjustKind}
                  onChange={(e) => setAdjustKind(e.target.value as "PERCENT" | "AMOUNT")}
                >
                  <option value="PERCENT">Percentage (%)</option>
                  <option value="AMOUNT">Amount ({currency} / dish)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="r-adjust-value" className="text-xs font-medium">{adjustKind === "PERCENT" ? "Percent (%)" : `Amount (${currency})`}</Label>
                <Input
                  id="r-adjust-value"
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                  value={adjustValue}
                  onChange={(e) => setAdjustValue(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground font-medium" aria-live="polite">
              {Number(adjustValue) > 0
                ? `Preview: A ${currency} 100 dish will cost ${currency} ${Math.max(
                    Math.round(
                      (adjustKind === "PERCENT"
                        ? 100 * (1 + ((adjustDir === "cheaper" ? -1 : 1) * Number(adjustValue)) / 100)
                        : 100 + (adjustDir === "cheaper" ? -1 : 1) * Number(adjustValue)) * 100,
                    ) / 100,
                    0,
                  )} online.`
                : "No change to online ordering prices."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-online-min" className="text-xs font-semibold">Minimum Online Order ({currency})</Label>
            <Input
              id="r-online-min"
              type="number"
              min="0"
              step="1"
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
              value={onlineMinOrder}
              onChange={(e) => setOnlineMinOrder(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Orders from your direct website below this amount are refused (0 = no minimum).
            </p>
          </div>

          {/* Cashier Discount Limits */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-max-discount" className="text-xs font-semibold">Max Cashier Discount (%)</Label>
              <Input
                id="r-max-discount"
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                100 = unconstrained. Managers with override rights can exceed this.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium sm:pt-6 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input text-primary"
                checked={requireReason}
                onChange={(e) => setRequireReason(e.target.checked)}
              />
              <span>Require reason for cashier discounts</span>
            </label>
          </div>

          {/* UPI Payment ID */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-upi" className="text-xs font-semibold">UPI ID (QR Payments)</Label>
              <Input
                id="r-upi"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium font-mono"
                value={upiVpa}
                onChange={(e) => setUpiVpa(e.target.value)}
                placeholder="restaurant@bank"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-upi-name" className="text-xs font-semibold">UPI Payee Display Name</Label>
              <Input
                id="r-upi-name"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
                value={upiPayeeName}
                onChange={(e) => setUpiPayeeName(e.target.value)}
                placeholder={name}
                maxLength={60}
              />
            </div>
          </div>

          <StatusNote note={saveNote} onClear={clearSaveNote} />
          <Button 
            type="submit" 
            disabled={updateRestaurant.isPending} 
            className="h-11 sm:h-9 rounded-xl text-xs font-semibold self-start px-5 active:scale-98"
          >
            {updateRestaurant.isPending ? "Saving Details…" : "Save Restaurant Profile"}
          </Button>
        </form>
      </Card>

      {/* Branch Settings Card */}
      <Card className="flex flex-col gap-4 p-4 sm:p-6 rounded-2xl border border-border/80 shadow-2xs">
        <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Building2 className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-foreground">Current Branch Details</h2>
            <p className="text-xs text-muted-foreground">Store location, tax regimes, and local billing configuration</p>
          </div>
        </div>

        <form onSubmit={onSubmitBranch} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-name" className="text-xs font-semibold">Branch Name *</Label>
            <Input 
              id="b-name" 
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
              value={branchName} 
              onChange={(e) => setBranchName(e.target.value)} 
              required 
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-address" className="text-xs font-semibold">Street Address</Label>
            <Input 
              id="b-address" 
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
              value={address} 
              onChange={(e) => setAddress(e.target.value)} 
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="b-phone" className="text-xs font-semibold">Contact Phone</Label>
              <Input 
                id="b-phone" 
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
                value={phone} 
                onChange={(e) => setPhone(e.target.value)} 
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="b-gst" className="text-xs font-semibold">GST / Tax Registration</Label>
              <Input 
                id="b-gst" 
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium font-mono"
                value={gstNumber} 
                onChange={(e) => setGstNumber(e.target.value)} 
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-3.5 sm:p-4 bg-muted/20">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-foreground">Tax Configuration</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Picks how menu prices and printed customer receipts compute tax for this branch.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="b-tax-regime" className="text-xs font-medium">Region / Regime</Label>
                <Select value={taxRegime} onValueChange={onRegimeChange}>
                  <SelectTrigger id="b-tax-regime" className="h-11 sm:h-9 rounded-xl text-xs sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_REGIMES.map((regime) => (
                      <SelectItem key={regime} value={regime}>
                        {TAX_REGIME_PRESETS[regime].displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="b-tax-mode" className="text-xs font-medium">Menu Prices Are</Label>
                <Select value={taxMode} onValueChange={(v) => setTaxMode(v as TaxMode)}>
                  <SelectTrigger id="b-tax-mode" className="h-11 sm:h-9 rounded-xl text-xs sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INCLUSIVE">Tax-inclusive (Included)</SelectItem>
                    <SelectItem value="EXCLUSIVE">Tax-exclusive (Added at checkout)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {preset.exampleRates} — set exact percentage rates per item under Menu.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="b-country" className="text-xs font-semibold">Country Code</Label>
              <Input
                id="b-country"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium uppercase font-mono"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="b-tax-id" className="text-xs font-semibold">{TAX_REGIME_PRESETS[taxRegime].taxIdLabel}</Label>
              <Input 
                id="b-tax-id" 
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium font-mono"
                value={taxId} 
                onChange={(e) => setTaxId(e.target.value)} 
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="b-tax-label" className="text-xs font-semibold">Receipt Label Override</Label>
            <Input
              id="b-tax-label"
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium"
              value={taxLabel}
              onChange={(e) => setTaxLabel(e.target.value)}
              placeholder={preset.taxLabel}
            />
          </div>

          <Button 
            type="submit" 
            disabled={updateBranch.isPending} 
            className="h-11 sm:h-9 rounded-xl text-xs font-semibold self-start px-5 active:scale-98"
          >
            {updateBranch.isPending ? "Saving Branch…" : "Save Branch Details"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
