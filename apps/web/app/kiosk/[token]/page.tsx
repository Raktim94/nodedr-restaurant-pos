"use client";

import { use } from "react";
import { KioskApp } from "@/components/kiosk/kiosk-app";
import { I18nProvider } from "@/lib/i18n/context";

export default function KioskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  // Pinned to Spanish and independent of the staff UI's saved language.
  return (
    <I18nProvider fixedLocale="es">
      <KioskApp token={token} />
    </I18nProvider>
  );
}
