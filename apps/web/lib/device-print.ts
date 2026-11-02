// Printing from the phone itself (OrderRestro Android app): a paired Bluetooth
// thermal printer, or Android's print dialog (Save as PDF and every installed
// printer). In a normal browser everything here is off and the existing
// browser / server-printer paths are used.
import { isNativeApp, plugin } from "@/lib/native";

export interface BtPrinter {
  name: string;
  address: string;
}

interface NativePrinterApi {
  btPrinters: () => Promise<{ enabled: boolean; supported: boolean; devices: BtPrinter[] }>;
  btPrint: (o: { address: string; data: string }) => Promise<void>;
  printHtml: (o: { html: string; name?: string }) => Promise<void>;
}

const KEY = "orderrestro.btPrinter";

export function nativePrinter(): NativePrinterApi | null {
  return plugin<NativePrinterApi>("NativePrinter");
}

/** True inside the app on a phone that can print by itself. */
export function canPrintOnDevice(): boolean {
  return isNativeApp() && !!nativePrinter();
}

export function savedBtPrinter(): BtPrinter | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BtPrinter) : null;
  } catch {
    return null;
  }
}

export function saveBtPrinter(p: BtPrinter | null) {
  try {
    if (p) window.localStorage.setItem(KEY, JSON.stringify(p));
    else window.localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the printer is asked for again next time
  }
}

export class PrinterNotChosen extends Error {
  constructor() {
    super("No Bluetooth printer chosen. Pair the printer in the phone's Bluetooth settings, then choose it here.");
  }
}

// --- picker bus: the printing code asks, the dialog (mounted once) answers -----
type Resolve = (p: BtPrinter | null) => void;
let pickerListener: ((resolve: Resolve) => void) | null = null;

export function registerPrinterPicker(listener: (resolve: Resolve) => void) {
  pickerListener = listener;
  return () => {
    if (pickerListener === listener) pickerListener = null;
  };
}

/** Opens the "choose a Bluetooth printer" dialog and resolves with the choice. */
export function chooseBtPrinter(): Promise<BtPrinter | null> {
  return new Promise((resolve) => (pickerListener ? pickerListener(resolve) : resolve(null)));
}

/** Sends ESC/POS data (base64 from the server) to the chosen Bluetooth printer. */
export async function printEscposOnDevice(chunks: string[]): Promise<void> {
  const np = nativePrinter();
  if (!np) throw new Error("Bluetooth printing works in the OrderRestro app on a phone.");
  let printer = savedBtPrinter();
  if (!printer) {
    printer = await chooseBtPrinter();
    if (!printer) throw new PrinterNotChosen();
    saveBtPrinter(printer);
  }
  for (const data of chunks) await np.btPrint({ address: printer.address, data });
}

/** Opens Android's print dialog for a bill / receipt / ticket (Save as PDF or any printer). */
export async function printHtmlOnDevice(html: string, name: string): Promise<void> {
  const np = nativePrinter();
  if (!np) throw new Error("Not available outside the app");
  await np.printHtml({ html, name });
}
