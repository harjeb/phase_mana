import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface TrendPointView {
  label: string;
  value: number;
  /** Native tooltip text, e.g. "12 games, 7–5". */
  detail?: string;
}

interface TrendChartProps {
  title: string;
  points: TrendPointView[];
  variant?: "bar" | "line";
  /** Fixed top of the y-axis; defaults to the largest value (min 1). */
  max?: number;
  formatValue?: (value: number) => string;
  className?: string;
}

const VIEW_W = 300;
const VIEW_H = 100;
const PAD = 6;

/**
 * Dependency-free SVG chart. Two shapes cover what the stats page needs: bars
 * for volume per day, a line for win rate. `preserveAspectRatio="none"` lets it
 * stretch to its container; the line keeps a crisp stroke via non-scaling-stroke.
 */
export function TrendChart({
  title,
  points,
  variant = "bar",
  max,
  formatValue,
  className,
}: TrendChartProps) {
  const top = max ?? Math.max(1, ...points.map((point) => point.value));
  const format = formatValue ?? ((value: number) => String(value));
  const plotW = VIEW_W - PAD * 2;
  const plotH = VIEW_H - PAD * 2;
  const valuePoints = points.map((point, index) => ({
    ...point,
    x: variant === "line"
      ? PAD + (points.length > 1 ? (index / (points.length - 1)) * plotW : plotW / 2)
      : PAD + ((index + 0.5) / points.length) * plotW,
    y: PAD + plotH - (point.value / top) * plotH,
  }));

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-baseline justify-between space-y-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="text-xs text-muted-foreground">{format(top)}</span>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">—</p>
        ) : (
          <svg
            role="img"
            aria-label={title}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="h-28 w-full overflow-visible"
          >
            <line
              x1={PAD}
              x2={VIEW_W - PAD}
              y1={VIEW_H - PAD}
              y2={VIEW_H - PAD}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {variant === "bar" ? (
              valuePoints.map((point) => (
                <rect
                  key={`${point.label}-${point.x}`}
                  x={point.x - (plotW / points.length) * 0.3}
                  y={point.y}
                  width={(plotW / points.length) * 0.6}
                  height={Math.max(0, VIEW_H - PAD - point.y)}
                  rx={1}
                  className="fill-primary/70"
                >
                  <title>{point.detail ?? `${point.label}: ${format(point.value)}`}</title>
                </rect>
              ))
            ) : (
              <>
                <polyline
                  points={valuePoints.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  className="stroke-primary"
                />
                {valuePoints.map((point) => (
                  <circle key={`${point.label}-${point.x}`} cx={point.x} cy={point.y} r={1.5} className="fill-primary">
                    <title>{point.detail ?? `${point.label}: ${format(point.value)}`}</title>
                  </circle>
                ))}
              </>
            )}
          </svg>
        )}
        {points.length > 0 && (
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{points[0]?.label}</span>
            <span>{points[points.length - 1]?.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
