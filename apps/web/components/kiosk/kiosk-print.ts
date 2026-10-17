import { buildTicketHtml, type TicketData } from "@/lib/kiosk-ticket";

// Prints the customer's order ticket through the browser's normal print path
// (hidden iframe + window.print). That opens the platform print dialog; it
// does NOT print silently, and it cannot know whether a printer exists or
// whether the driver honours the 80 mm page size / paper cut. Returns false
// when the browser has no usable print function so the UI can say so; a
// true result only means "the print dialog was opened", never "paper came
// out" and never "the order is paid".
export function printTicket(data: TicketData): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof window.print !== "function") {
      resolve(false);
      return;
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;top:-10000px;left:-10000px;width:302px;height:600px;border:0;";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      // Leave the frame alive briefly: some browsers print asynchronously.
      setTimeout(() => frame.remove(), 60_000);
    };
    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        if (!win) return finish(false);
        win.focus();
        win.print();
        finish(true);
      } catch {
        finish(false);
      }
    };
    frame.srcdoc = buildTicketHtml(data);
    document.body.appendChild(frame);
    setTimeout(() => finish(false), 8_000);
  });
}
