import type { ReactNode } from "react";
import { AuthProvider } from "./auth";
import { ColorThemeProvider } from "./color-theme";
import { ShellDataProvider } from "./shell-data";

// CoreDataProvider is NOT mounted globally. It is injected only for legacy routes that still
// depend on the universal snapshot, via LegacySnapshotOutlet in App.tsx. Dashboard routes
// receive no CoreDataProvider — they load their own data through per-page hooks (Phase 2A+).
// Remove LegacySnapshotOutlet entirely at Phase 8 cutover.

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ColorThemeProvider>
      <AuthProvider>
        <ShellDataProvider>{children}</ShellDataProvider>
      </AuthProvider>
    </ColorThemeProvider>
  );
}
