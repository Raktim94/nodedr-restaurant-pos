import Image from "next/image";
import { cn } from "@/lib/utils";

export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  const common = cn("shrink-0 rounded-lg object-contain", className);
  return (
    <>
      <Image src="/logo.png" alt="Restrovia" width={size} height={size} className={cn(common, "dark:hidden")} priority />
      <Image src="/logo-dark.png" alt="" aria-hidden width={size} height={size} className={cn(common, "hidden dark:block")} priority />
    </>
  );
}
