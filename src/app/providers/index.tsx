import type { ReactNode } from "react";
import { AuthProvider } from "./auth";
import { ColorThemeProvider } from "./color-theme";
import { ShellDataProvider } from "./shell-data";

// There is no global data provider. ShellDataProvider supplies only the lightweight shell
// lookups (users/clients/mappings) every route needs; each page loads its own data through a
// per-page hook backed by one orm-gateway select action (ADR-0009).

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ColorThemeProvider>
      <AuthProvider>
        <ShellDataProvider>{children}</ShellDataProvider>
      </AuthProvider>
    </ColorThemeProvider>
  );
}
