import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { repository } from "../data/repository";
import type { ClientCustomFieldType, LeadCustomFieldRecord } from "../types/core";
import { LightweightSheet } from "./ui/lightweight-sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/**
 * Admin/master_admin tool to manage per-client custom Leads-report columns (Task 4F). Definitions
 * are scoped to one client at a time; managers cannot create definitions (Batch 4 decision) but may
 * be granted value-edit rights via `editable_by`.
 */

const FIELD_TYPE_OPTIONS: ClientCustomFieldType[] = ["text", "number", "currency", "checkbox", "droplist", "link"];
const ROLE_OPTIONS = ["master_admin", "admin", "manager", "client"] as const;

interface LeadCustomColumnsManagerProps {
  clientsLite: Array<{ id: string; name: string }>;
  /** Pre-select this client when opening (e.g. the active client filter). */
  defaultClientId?: string;
  /** Called after any create/update/delete so the report can reload its columns. */
  onChanged: () => void;
}

export const LeadCustomColumnsManager = memo(function LeadCustomColumnsManager({
  clientsLite,
  defaultClientId,
  onChanged,
}: LeadCustomColumnsManagerProps) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [fields, setFields] = useState<LeadCustomFieldRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ClientCustomFieldType>("text");
  const [newOptions, setNewOptions] = useState("");
  const [newEditableBy, setNewEditableBy] = useState<string[]>(["master_admin", "admin"]);

  useEffect(() => {
    if (!open) return;
    if (!clientId) { setFields([]); return; }
    let cancelled = false;
    setLoading(true);
    repository
      .loadLeadCustomFields(clientId)
      .then((rows) => { if (!cancelled) setFields(rows); })
      .catch(() => { if (!cancelled) toast.error("Could not load custom columns."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, clientId]);

  function openSheet() {
    setClientId(defaultClientId ?? "");
    setOpen(true);
  }

  async function reload() {
    if (!clientId) return;
    setFields(await repository.loadLeadCustomFields(clientId));
    onChanged();
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name || !clientId) return;
    let options: string[] | null = null;
    if (newType === "droplist") {
      options = newOptions.split(",").map((s) => s.trim()).filter(Boolean);
      if (options.length === 0) { toast.error("Droplist needs at least one option."); return; }
    }
    const editable_by = newEditableBy.length > 0 ? newEditableBy : ["master_admin"];
    try {
      await repository.createLeadCustomField({ client_id: clientId, name, field_type: newType, options, position: fields.length, editable_by });
      setNewName(""); setNewOptions(""); setNewType("text"); setNewEditableBy(["master_admin", "admin"]);
      await reload();
      toast.success("Custom column added.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not add column.");
    }
  }

  async function handleDelete(fieldId: string) {
    try {
      await repository.deleteLeadCustomField(fieldId);
      await reload();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not delete column.");
    }
  }

  async function toggleEditableBy(field: LeadCustomFieldRecord, role: string) {
    if (role === "master_admin") return; // always retained
    const next = field.editable_by.includes(role)
      ? field.editable_by.filter((r) => r !== role)
      : [...field.editable_by, role];
    try {
      await repository.updateLeadCustomField(field.id, { editable_by: next });
      await reload();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not update permissions.");
    }
  }

  return (
    <>
      <button
        onClick={openSheet}
        className="rounded-full border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm text-sky-200 transition hover:bg-sky-500/20"
      >
        Manage columns
      </button>
      <LightweightSheet
        open={open}
        onOpenChange={setOpen}
        title={<span className="text-white">Custom lead columns</span>}
        description="Per-client columns shown on the Leads report. Definitions are admin-only."
        className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-lg"
      >
        <div className="space-y-5 px-6 pb-6">
          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client</span>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                {clientsLite.map((client) => (
                  <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {!clientId ? (
            <p className="text-sm text-muted-foreground">Select a client to manage its custom columns.</p>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Existing columns</p>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : fields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No custom columns yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {fields.map((field) => (
                      <li key={field.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-white">{field.name}</p>
                            <p className="text-xs text-muted-foreground">{field.field_type}{field.options?.length ? ` · ${field.options.join(", ")}` : ""}</p>
                          </div>
                          <button onClick={() => handleDelete(field.id)} className="shrink-0 rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-200 transition hover:bg-rose-500/10">Delete</button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Editable by</span>
                          {ROLE_OPTIONS.map((role) => (
                            <label key={role} className="flex items-center gap-1.5 text-xs text-neutral-300">
                              <input
                                type="checkbox"
                                checked={field.editable_by.includes(role)}
                                disabled={role === "master_admin"}
                                onChange={() => void toggleEditableBy(field, role)}
                                className="h-3.5 w-3.5 accent-sky-500"
                              />
                              {role}
                            </label>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/10 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Add column</p>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Column name" className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none" />
                <Select value={newType} onValueChange={(v) => setNewType(v as ClientCustomFieldType)}>
                  <SelectTrigger className="h-auto w-full rounded-xl border-white/10 bg-black/20 px-3 py-2 text-sm text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                    {FIELD_TYPE_OPTIONS.map((type) => <SelectItem key={type} value={type} className="text-white focus:bg-[#1a1a1a] focus:text-white">{type}</SelectItem>)}
                  </SelectContent>
                </Select>
                {newType === "droplist" && (
                  <input value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="Options, comma-separated" className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none" />
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Editable by</span>
                  {ROLE_OPTIONS.map((role) => (
                    <label key={role} className="flex items-center gap-1.5 text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        checked={newEditableBy.includes(role)}
                        disabled={role === "master_admin"}
                        onChange={() => setNewEditableBy((cur) => cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role])}
                        className="h-3.5 w-3.5 accent-sky-500"
                      />
                      {role}
                    </label>
                  ))}
                </div>
                <button onClick={() => void handleCreate()} disabled={!newName.trim()} className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50">Add column</button>
              </div>
            </>
          )}
        </div>
      </LightweightSheet>
    </>
  );
});
