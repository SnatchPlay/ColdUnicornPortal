import { ArrowUp, ArrowDown, TrendingUp } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: number[];
  icon?: React.ReactNode;
}

export function MetricCard({ title, value, change, trend, icon }: MetricCardProps) {
  const isPositive = change && change > 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4 hover:border-primary/20 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon && <div className="text-muted-foreground">{icon}</div>}
          <h3 className="text-sm text-muted-foreground">{title}</h3>
        </div>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
            isPositive ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
          }`}>
            {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            <span>{Math.abs(change)}%</span>
          </div>
        )}
      </div>

      <div className="mb-2">
        <div className="text-3xl font-semibold">{value}</div>
      </div>

      {trend && trend.length > 0 && (
        <div className="h-8 flex items-end gap-0.5">
          {trend.map((height, i) => (
            <div
              key={i}
              className="flex-1 bg-gradient-to-t from-primary/20 to-primary/40 rounded-t"
              style={{ height: `${(height / Math.max(...trend)) * 100}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
