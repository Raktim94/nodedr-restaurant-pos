"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  TAX_REGIME_PRESETS,
  TAX_REGIMES,
  type TaxMode,
  type TaxRegime,
} from "@nodedr-restaurant/types";
import { PrinterDiagnosticsCard } from "@/components/settings/printer-diagnostics-card";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type BranchSettings,
  type RestaurantSettings,
} from "@/hooks/use-settings";
import { ApiError } from "@/lib/api";

export default function SettingsPage() {
  const { branchId } = useBranch();
  const { data, isLoading } = useSettings(branchId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Restaurant, branch, and staff configuration</p>
      </div>

      <SettingsTabs />

      {isLoading || !data ? (
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

      <NotificationSettingsCard />

      <PrinterDiagnosticsCard />
    </div>
  );
}

function NotificationSettingsCard() {
  const [muted, toggleMuted] = useNotificationMute();

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-medium text-foreground">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          New orders, table reservations, and kitchen tickets on this device.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="notification-sound">Notification sound</Label>
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
  const [currency, setCurrency] = useState(restaurant.currency);
  const [timezone, setTimezone] = useState(restaurant.timezone);
  const [loyaltyPointValue, setLoyaltyPointValue] = useState(restaurant.loyaltyPointValue);
  const [loyaltyEarnPerCurrency, setLoyaltyEarnPerCurrency] = useState(
    String(restaurant.loyaltyEarnPerCurrency),
  );

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
  const updateBranch = useUpdateBranchSettings(branchId);

  const onSubmitRestaurant = (e: React.FormEvent) => {
    e.preventDefault();
    updateRestaurant.mutate(
      {
        name,
        legalName: legalName || undefined,
        currency,
        timezone,
        loyaltyPointValue: Number(loyaltyPointValue) || 0,
        loyaltyEarnPerCurrency: Number(loyaltyEarnPerCurrency) || 1,
      },
      {
        onSuccess: () => toast.success("Restaurant details saved"),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save"),
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[18px] font-medium text-foreground">Restaurant</h2>
        <form onSubmit={onSubmitRestaurant} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-name">Name</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-legal">Legal name</Label>
            <Input id="r-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-currency">Currency</Label>
              <Input
                id="r-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-timezone">Timezone</Label>
              <Input id="r-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground">Loyalty program</h3>
            <p className="text-xs text-muted-foreground">
              How customers earn and redeem points at checkout.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-loyalty-earn">Earn 1 point per</Label>
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
              <Label htmlFor="r-loyalty-value">1 point redeems for</Label>
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

          <Button type="submit" disabled={updateRestaurant.isPending} className="self-start">
            {updateRestaurant.isPending ? "Saving…" : "Save restaurant"}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[18px] font-medium text-foreground">This branch</h2>
        <form onSubmit={onSubmitBranch} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="b-name">Branch name</Label>
            <Input id="b-name" value={branchName} onChange={(e) => setBranchName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="b-address">Address</Label>
            <Input id="b-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-phone">Phone</Label>
              <Input id="b-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-gst">GST number (legacy)</Label>
              <Input id="b-gst" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground">Tax</h3>
            <p className="text-xs text-muted-foreground">
              Picks how menu prices and receipts handle tax for this branch.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-tax-regime">Region / regime</Label>
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
              <Label htmlFor="b-tax-mode">Menu prices are</Label>
              <Select value={taxMode} onValueChange={(v) => setTaxMode(v as TaxMode)}>
                <SelectTrigger id="b-tax-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INCLUSIVE">Tax-inclusive</SelectItem>
                  <SelectItem value="EXCLUSIVE">Tax-exclusive (tax added at checkout)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {preset.exampleRates} — set the exact rate per menu item under Menu.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="b-country">Country code</Label>
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
            <Label htmlFor="b-tax-label">Receipt label override (optional)</Label>
            <Input
              id="b-tax-label"
              value={taxLabel}
              onChange={(e) => setTaxLabel(e.target.value)}
              placeholder={preset.taxLabel}
            />
          </div>

          <Button type="submit" disabled={updateBranch.isPending} className="self-start">
            {updateBranch.isPending ? "Saving…" : "Save branch"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
