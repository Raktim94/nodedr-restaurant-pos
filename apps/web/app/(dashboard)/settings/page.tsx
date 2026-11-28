"use client";

import { useI18n } from "@/lib/i18n/context";
import { ImagePlus, X } from "lucide-react";
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
import { QueryError } from "@/components/ui/query-error";

export default function SettingsPage() {
  const { t } = useI18n();
  const { branchId } = useBranch();
  const { data, isLoading, isError, error, refetch, isFetching } = useSettings(branchId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Settings")}</h1>
        <p className="text-sm text-muted-foreground">{t("Restaurant, branch, and staff configuration")}</p>
      </div>

      <SettingsTabs />

      {isError ? (
        <QueryError error={error} what={t("the settings")} onRetry={() => void refetch()} retrying={isFetching} />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
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

      {data && <KitchenTicketsCard key={`tickets-${data.branch.id}`} branchId={branchId} branch={data.branch} />}

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
  const { t } = useI18n();
  const update = useUpdateBranchSettings(branchId);
  const save = (dto: { autoConfirmOrders?: boolean; autoConfirmReservations?: boolean }) =>
    update.mutate(dto, {
      onSuccess: () => toast.success(t("Saved")),
      onError: (err) => toast.error(err instanceof Error ? err.message : t("Could not save")),
    });

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-medium text-foreground">{t("Online orders & table bookings")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Choose whether orders and bookings from your website are accepted automatically or wait for you to accept them. You can always cancel an order or booking from its window.")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="auto-confirm-orders">{t("Auto-confirm online orders")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("Off = each new order rings, then waits for you to Accept or Reject before it reaches the kitchen. On = sent to the kitchen straight away.")}
          </p>
        </div>
        <Switch
          id="auto-confirm-orders"
          checked={branch.autoConfirmOrders}
          disabled={update.isPending}
          onCheckedChange={(v) => save({ autoConfirmOrders: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="auto-confirm-bookings">{t("Auto-confirm table bookings")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("Off = new bookings wait for you to Accept. On = confirmed automatically.")}
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

function KitchenTicketsCard({
  branchId,
  branch,
}: {
  branchId: string | null;
  branch: { ticketMode: "KDS" | "BILL_ONLY" };
}) {
  const { t } = useI18n();
  const update = useUpdateBranchSettings(branchId);
  const kds = branch.ticketMode !== "BILL_ONLY";
  const save = (v: boolean) =>
    update.mutate(
      { ticketMode: v ? "KDS" : "BILL_ONLY" },
      {
        onSuccess: () => toast.success(t("Saved")),
        onError: (err) => toast.error(err instanceof Error ? err.message : t("Could not save")),
      },
    );

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-medium text-foreground">{t("Kitchen tickets")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Choose how orders reach your kitchen. Restaurants without a Kitchen Display can use bill-only mode.")}
        </p>

      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="ticket-mode-kds">{t("Live order tickets by station (Kitchen Display)")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("On = each paid order creates station-grouped tickets that appear live on the Kitchen Display. Off = bill only, no kitchen ticket is created.")}
          </p>
        </div>
        <Switch
          id="ticket-mode-kds"
          checked={kds}
          disabled={update.isPending}
          onCheckedChange={save}
        />
      </div>
    </Card>
  );
}

function NotificationSettingsCard() {
  const { t } = useI18n();
  const [muted, toggleMuted] = useNotificationMute();

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-medium text-foreground">{t("Notifications")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("New orders, table reservations, and kitchen tickets on this device.")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="notification-sound">{t("Notification sound")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("Plays a chime for new orders, reservations, and kitchen display tickets. This only affects this device/browser — mute the kitchen display separately from the office if needed.")}
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
  const { t } = useI18n();
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
        onSuccess: () => saveToast.success(t("Restaurant details saved")),
        onError: (err) => saveToast.error(err instanceof ApiError ? err.message : t("Could not save")),
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
        onSuccess: () => toast.success(t("Branch details saved")),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not save")),
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[18px] font-medium text-foreground">{t("Restaurant")}</h2>
        <form onSubmit={onSubmitRestaurant} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("Logo")}</Label>
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
                      toast.error(err instanceof ApiError ? err.message : t("Could not upload logo")),
                  });
                }}
              />
              {logoUrl ? (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
                  {/* eslint-disable-next-line @next/next/no-img-element -- uploaded asset served from the backend, not a Next-optimizable remote source */}
                  <img src={logoUrl} alt="" className="h-full w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => {
                      setLogoUrl(null);
                      if (logoInputRef.current) logoInputRef.current.value = "";
                    }}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-foreground"
                    aria-label={t("Remove logo")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadLogo.isPending}
                  className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <ImagePlus className="h-4 w-4" />
                  <span className="text-[10px]">
                    {uploadLogo.isPending ? t("Uploading…") : t("Upload")}
                  </span>
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                {t("Shows in the app sidebar and login screen instead of the OrderRestro mark. Square, at least 256×256px, PNG with a transparent background works best.")}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-name">{t("Name")}</Label>
            <Input
              id="r-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, RESTAURANT_NAME_MAX_LENGTH))}
              maxLength={RESTAURANT_NAME_MAX_LENGTH}
              required
            />
            <p className="text-right text-xs text-muted-foreground">
              {name.length}/{RESTAURANT_NAME_MAX_LENGTH}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-legal">{t("Legal name")}</Label>
            <Input id="r-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-currency">{t("Currency")}</Label>
              <Input
                id="r-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-timezone">{t("Timezone")}</Label>
              <Input id="r-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground">{t("Loyalty program")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("How customers earn and redeem points at checkout.")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-loyalty-earn">{t("Earn 1 point per")}</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{currency}</span>
                <Input
                  id="r-loyalty-earn"
                  type="number"
                  min="1"
                  step="1"
                  value={loyaltyEarnPerCurrency}
                  onChange={(e) => setLoyaltyEarnPerCurrency(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-loyalty-value">{t("1 point redeems for")}</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{currency}</span>
                <Input
                  id="r-loyalty-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={loyaltyPointValue}
                  onChange={(e) => setLoyaltyPointValue(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-foreground">{t("Referral rewards")}</h3>
                <p className="text-xs text-muted-foreground">{t("Customers share a dish or their personal link. Points are paid only after the new customer's first purchase is paid. Points are worth the “1 point redeems for” amount above (for 100 points = {currency} 10, enter 0.10).", { currency })}</p>
              </div>
              <Switch
                id="r-referral-enabled"
                aria-label={t("Enable referral rewards")}
                checked={referralEnabled}
                onCheckedChange={setReferralEnabled}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="r-referral-sharer">{t("Points for the customer who shares")}</Label>
                <Input
                  id="r-referral-sharer"
                  type="number"
                  min="0"
                  step="1"
                  disabled={!referralEnabled}
                  value={referralSharerPoints}
                  onChange={(e) => setReferralSharerPoints(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="r-referral-referred">{t("Points for the new customer")}</Label>
                <Input
                  id="r-referral-referred"
                  type="number"
                  min="0"
                  step="1"
                  disabled={!referralEnabled}
                  value={referralReferredPoints}
                  onChange={(e) => setReferralReferredPoints(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-referral-min">{t("Minimum food value of the first order for rewards ({currency})", { currency })}</Label>
              <Input
                id="r-referral-min"
                type="number"
                min="0"
                step="1"
                disabled={!referralEnabled}
                value={referralMinPurchase}
                onChange={(e) => setReferralMinPurchase(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">{t("Website food prices")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("Make every dish cheaper or costlier for customers ordering on your website, by a percentage or a fixed amount. In-restaurant, POS and marketplace prices do not change. Leave at 0 for no change.")}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="r-adjust-dir">{t("Make prices")}</Label>
                <select
                  id="r-adjust-dir"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={adjustDir}
                  onChange={(e) => setAdjustDir(e.target.value as "cheaper" | "costlier")}
                >
                  <option value="cheaper">{t("Cheaper")}</option>
                  <option value="costlier">{t("Costlier")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="r-adjust-kind">{t("By")}</Label>
                <select
                  id="r-adjust-kind"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={adjustKind}
                  onChange={(e) => setAdjustKind(e.target.value as "PERCENT" | "AMOUNT")}
                >
                  <option value="PERCENT">{t("Percentage (%)")}</option>
                  <option value="AMOUNT">{t("Amount ({currency} per dish)", { currency })}</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="r-adjust-value">{adjustKind === "PERCENT" ? t("Percent") : t("Amount ({currency})", { currency })}</Label>
                <Input
                  id="r-adjust-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustValue}
                  onChange={(e) => setAdjustValue(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {Number(adjustValue) > 0
                ? t("A {currency} 100 dish will cost {currency2} {max} on the website.", { currency, currency2: currency, max: Math.max(
                    Math.round(
                      (adjustKind === "PERCENT"
                        ? 100 * (1 + ((adjustDir === "cheaper" ? -1 : 1) * Number(adjustValue)) / 100)
                        : 100 + (adjustDir === "cheaper" ? -1 : 1) * Number(adjustValue)) * 100,
                    ) / 100,
                    0,
                  ) })
                : t("No change to website prices.")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="r-online-min">{t("Smallest online order accepted ({currency}, 0 = no minimum)", { currency })}</Label>
            <Input
              id="r-online-min"
              type="number"
              min="0"
              step="1"
              value={onlineMinOrder}
              onChange={(e) => setOnlineMinOrder(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("Orders from your website or the API below this amount are refused. Marketplace orders (Zomato, Swiggy) and table QR orders are not affected.")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-max-discount">{t("Highest cashier discount (%)")}</Label>
              <Input
                id="r-max-discount"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("100 means no limit. Owners, administrators and roles with “Discount Above the Cashier Limit” can go higher.")}
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm sm:pt-7">
              <input
                type="checkbox"
                className="mt-1"
                checked={requireReason}
                onChange={(e) => setRequireReason(e.target.checked)}
              />
              {t("Require a reason for every discount")}
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-upi">{t("UPI id (for QR payments)")}</Label>
              <Input
                id="r-upi"
                value={upiVpa}
                onChange={(e) => setUpiVpa(e.target.value)}
                placeholder={t("yourshop@okbank")}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t("Shown as a scannable QR at checkout and on the customer display, with the exact bill amount filled in.")}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-upi-name">{t("UPI payee name")}</Label>
              <Input
                id="r-upi-name"
                value={upiPayeeName}
                onChange={(e) => setUpiPayeeName(e.target.value)}
                placeholder={name}
                maxLength={60}
              />
            </div>
          </div>

          <StatusNote note={saveNote} onClear={clearSaveNote} />
          <Button type="submit" disabled={updateRestaurant.isPending} className="self-start">
            {updateRestaurant.isPending ? t("Saving…") : t("Save restaurant")}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[18px] font-medium text-foreground">{t("This branch")}</h2>
        <form onSubmit={onSubmitBranch} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="b-name">{t("Branch name")}</Label>
            <Input id="b-name" value={branchName} onChange={(e) => setBranchName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="b-address">{t("Address")}</Label>
            <Input id="b-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-phone">{t("Phone")}</Label>
              <Input id="b-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-gst">{t("GST number (legacy)")}</Label>
              <Input id="b-gst" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground">{t("Tax")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("Picks how menu prices and receipts handle tax for this branch.")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-tax-regime">{t("Region / regime")}</Label>
              <Select value={taxRegime} onValueChange={onRegimeChange}>
                <SelectTrigger id="b-tax-regime">
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-tax-mode">{t("Menu prices are")}</Label>
              <Select value={taxMode} onValueChange={(v) => setTaxMode(v as TaxMode)}>
                <SelectTrigger id="b-tax-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INCLUSIVE">{t("Tax-inclusive")}</SelectItem>
                  <SelectItem value="EXCLUSIVE">{t("Tax-exclusive (tax added at checkout)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("{exampleRates} — set the exact rate per menu item under Menu.", { exampleRates: preset.exampleRates })}</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-country">{t("Country code")}</Label>
              <Input
                id="b-country"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-tax-id">{TAX_REGIME_PRESETS[taxRegime].taxIdLabel}</Label>
              <Input id="b-tax-id" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="b-tax-label">{t("Receipt label override (optional)")}</Label>
            <Input
              id="b-tax-label"
              value={taxLabel}
              onChange={(e) => setTaxLabel(e.target.value)}
              placeholder={preset.taxLabel}
            />
          </div>

          <Button type="submit" disabled={updateBranch.isPending} className="self-start">
            {updateBranch.isPending ? t("Saving…") : t("Save branch")}
          </Button>
        </form>
      </Card>

      <p className="text-xs text-muted-foreground">{t("Nodedr OrderRestro is free software under the GNU AGPL-3.0. The source code of the version you are using is available to every user of this service at")} <a
          className="underline"
          href="https://github.com/Raktim94/nodedr-restaurant-pos"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/Raktim94/nodedr-restaurant-pos
        </a>
        .
      </p>
    </div>
  );
}
