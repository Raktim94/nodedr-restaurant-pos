import { redirect } from "next/navigation";

// Production reports now live inside Stock journal.
export default function ManufacturingReportsPage() {
  redirect("/inventory/journal?view=report");
}
