"use client";

// A small celebratory burst for the QR order confirmation moment — a
// handful of dots scaling out from center and fading, transform/opacity
// only so it stays smooth on the guest's own phone. Respects
// prefers-reduced-motion by not rendering the particles at all.
const PARTICLES = [
  { angle: 0, color: "bg-success", delay: 0 },
  { angle: 45, color: "bg-primary", delay: 20 },
  { angle: 90, color: "bg-warning", delay: 0 },
  { angle: 135, color: "bg-success", delay: 40 },
  { angle: 180, color: "bg-primary", delay: 10 },
  { angle: 225, color: "bg-warning", delay: 30 },
  { angle: 270, color: "bg-success", delay: 15 },
  { angle: 315, color: "bg-primary", delay: 35 },
];

export function PopBurst() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center motion-reduce:hidden"
    >
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className={`absolute h-2 w-2 rounded-full ${p.color} animate-pop-burst`}
          style={
            {
              "--angle": `${p.angle}deg`,
              animationDelay: `${p.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
