import Image from "next/image";
import { cn } from "@/lib/utils";

// Menu photos are uploaded as-is (up to 5 MB). Showing one as a 48px thumbnail
// straight from the file wastes megabytes, so uploaded images go through the
// Next.js optimizer: resized to the size actually drawn, converted to WebP and
// cached (their names are random and never reused, so the cache is permanent).
// Anything else - an external URL, a data URI - is shown untouched.
const UPLOADED = /^\/api\/uploads\/[\w.-]+$/;

export function UploadImage({
  src,
  width,
  height,
  className,
  alt = "",
  sizes,
  priority = false,
}: {
  src: string;
  width: number;
  height: number;
  className?: string;
  alt?: string;
  /** For images drawn wider than their intrinsic box (e.g. a card that fills its column). */
  sizes?: string;
  priority?: boolean;
}) {
  if (!UPLOADED.test(src)) {
    // eslint-disable-next-line @next/next/no-img-element -- not an uploaded asset, so not optimizable
    return <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className={className} />;
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      className={cn(className)}
    />
  );
}
