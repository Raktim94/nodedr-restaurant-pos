import { redirect } from "next/navigation";

// Production now lives inside Stock journal (one place for vouchers, entries and reports).
export default function ProductionPage() {
  redirect("/inventory/journal?view=entries");
}
