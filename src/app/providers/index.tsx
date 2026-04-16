import type { ReactNode } from "react";
import { AuthProvider } from "./auth";
import { CoreDataProvider } from "./core-data";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CoreDataProvider>{children}</CoreDataProvider>
    </AuthProvider>
  );
}
