"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
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
    </div>
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
      { name: branchName, address: address || undefined, phone: phone || undefined, gstNumber: gstNumber || undefined },
      {
        onSuccess: () => toast.success("Branch details saved"),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save"),
      },
    );
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
              <Label htmlFor="b-gst">GST number</Label>
              <Input id="b-gst" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={updateBranch.isPending} className="self-start">
            {updateBranch.isPending ? "Saving…" : "Save branch"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
