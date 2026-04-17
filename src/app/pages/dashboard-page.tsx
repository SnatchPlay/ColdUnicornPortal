import { useAuth } from "../providers/auth";
import { AdminDashboardPage } from "./admin-dashboard-page";
import { ClientDashboardPage } from "./client-dashboard-page";
import { ManagerDashboardPage } from "./manager-dashboard-page";

export function DashboardPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientDashboardPage />;
  if (identity?.role === "manager") return <ManagerDashboardPage />;
  return <AdminDashboardPage />;
}
