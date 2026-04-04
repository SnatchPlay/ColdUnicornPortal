export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src="figma:asset/455b4ba4c4b5dbf4fb8dd541f7b64c9044896928.png"
        alt="Cold Unicorn Logo"
        className="h-8 w-auto"
      />
      <div className="flex flex-col">
        <span className="text-sm opacity-60">GHEADS</span>
        <span className="text-xs opacity-40">PDCA Platform</span>
      </div>
    </div>
  );
}
