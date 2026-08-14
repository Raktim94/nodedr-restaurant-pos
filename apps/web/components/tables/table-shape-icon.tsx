type TableShape = "square" | "round" | "rect";

function seatPositions(shape: TableShape, capacity: number) {
  const n = Math.max(1, Math.min(capacity, 8));

  if (shape === "round") {
    return Array.from({ length: n }, (_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: 20 + Math.cos(angle) * 15, y: 20 + Math.sin(angle) * 15, r: 90 + (angle * 180) / Math.PI };
    });
  }

  // square / rect: distribute around the perimeter, long sides get more seats for rect
  const isRect = shape === "rect";
  const top = isRect ? Math.ceil(n / 3) : Math.ceil(n / 4);
  const bottom = isRect ? Math.ceil((n - top) / 2) : Math.ceil((n - top) / 3) || 0;
  const sideTotal = n - top - bottom;
  const left = Math.ceil(sideTotal / 2);
  const right = sideTotal - left;

  const w = isRect ? 30 : 22;
  const h = isRect ? 18 : 22;
  const x0 = 20 - w / 2;
  const y0 = 20 - h / 2;

  const seats: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < top; i++) seats.push({ x: x0 + ((i + 1) * w) / (top + 1), y: y0 - 4, r: 0 });
  for (let i = 0; i < right; i++) seats.push({ x: x0 + w + 4, y: y0 + ((i + 1) * h) / (right + 1), r: 90 });
  for (let i = 0; i < bottom; i++)
    seats.push({ x: x0 + w - ((i + 1) * w) / (bottom + 1), y: y0 + h + 4, r: 180 });
  for (let i = 0; i < left; i++) seats.push({ x: x0 - 4, y: y0 + h - ((i + 1) * h) / (left + 1), r: 270 });
  return seats;
}

export function TableShapeIcon({
  shape,
  capacity,
  className,
}: {
  shape: string;
  capacity: number;
  className?: string;
}) {
  const s: TableShape = shape === "round" || shape === "rect" ? shape : "square";
  const seats = seatPositions(s, capacity);

  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" stroke="currentColor" aria-hidden="true">
      {seats.map((seat, i) => (
        <rect
          key={i}
          x={-3}
          y={-2}
          width={6}
          height={4}
          rx={1.5}
          fill="currentColor"
          stroke="none"
          opacity={0.65}
          transform={`translate(${seat.x} ${seat.y}) rotate(${seat.r})`}
        />
      ))}
      {s === "round" && <circle cx={20} cy={20} r={11} strokeWidth={2} fill="currentColor" fillOpacity={0.12} />}
      {s === "square" && (
        <rect x={9} y={9} width={22} height={22} rx={4} strokeWidth={2} fill="currentColor" fillOpacity={0.12} />
      )}
      {s === "rect" && (
        <rect x={5} y={11} width={30} height={18} rx={4} strokeWidth={2} fill="currentColor" fillOpacity={0.12} />
      )}
    </svg>
  );
}
