import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

export type DateRange = {
  from: Date;
  to: Date;
  label: string;
};

const predefinedPeriods = [
  {
    label: 'Last 7 Days',
    getValue: () => ({
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      to: new Date(),
      label: 'Last 7 Days'
    })
  },
  {
    label: 'Last 30 Days',
    getValue: () => ({
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to: new Date(),
      label: 'Last 30 Days'
    })
  },
  {
    label: 'This Month',
    getValue: () => {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(),
        label: 'This Month'
      };
    }
  },
  {
    label: 'Last Month',
    getValue: () => {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        from: lastMonth,
        to: lastMonthEnd,
        label: 'Last Month'
      };
    }
  },
  {
    label: 'Last 3 Months',
    getValue: () => ({
      from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      to: new Date(),
      label: 'Last 3 Months'
    })
  },
  {
    label: 'This Quarter',
    getValue: () => {
      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3);
      return {
        from: new Date(now.getFullYear(), quarter * 3, 1),
        to: new Date(),
        label: 'This Quarter'
      };
    }
  },
  {
    label: 'This Year',
    getValue: () => {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), 0, 1),
        to: new Date(),
        label: 'This Year'
      };
    }
  }
];

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowCustom(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePredefinedSelect = (period: typeof predefinedPeriods[0]) => {
    const range = period.getValue();
    onChange(range);
    setIsOpen(false);
    setShowCustom(false);
  };

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      const from = new Date(customFrom);
      const to = new Date(customTo);

      if (from <= to) {
        onChange({
          from,
          to,
          label: `${from.toLocaleDateString('uk-UA')} - ${to.toLocaleDateString('uk-UA')}`
        });
        setIsOpen(false);
        setShowCustom(false);
        setCustomFrom('');
        setCustomTo('');
      }
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-secondary/50 hover:bg-secondary border border-border rounded-lg transition-colors"
      >
        <Calendar className="w-4 h-4" />
        <span className="text-sm">{value.label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-80 bg-card border border-border rounded-lg shadow-2xl z-50 overflow-hidden">
          {!showCustom ? (
            <div className="p-2">
              <div className="space-y-1">
                {predefinedPeriods.map((period) => (
                  <button
                    key={period.label}
                    onClick={() => handlePredefinedSelect(period)}
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors text-sm ${
                      value.label === period.label
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-secondary'
                    }`}
                  >
                    {period.label}
                  </button>
                ))}
              </div>

              <div className="border-t border-border mt-2 pt-2">
                <button
                  onClick={() => setShowCustom(true)}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-secondary transition-colors text-sm"
                >
                  Custom Range
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="mb-4">
                <h4 className="text-sm mb-3">Select Custom Date Range</h4>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">From</label>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">To</label>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowCustom(false)}
                  className="flex-1 px-3 py-2 bg-secondary hover:bg-secondary/80 border border-border rounded-md text-sm transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCustomApply}
                  disabled={!customFrom || !customTo}
                  className="flex-1 px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
