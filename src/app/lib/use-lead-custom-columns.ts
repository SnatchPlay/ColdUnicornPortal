import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { repository } from "../data/repository";
import type { AppRole, LeadCustomFieldRecord } from "../types/core";
import { leadCustomFieldColumn, type LeadReportColumn } from "./lead-report-columns";

interface CustomValue {
  lead_id: string;
  field_id: string;
  value: string | null;
}

interface UseLeadCustomColumnsArgs {
  role: AppRole | undefined;
  fields: LeadCustomFieldRecord[];
  values: CustomValue[];
}

/**
 * Builds the per-client custom report columns (Task 4F) from the loadLeadsList payload, wires
 * inline value editing through repository.upsertLeadCustomFieldValue with optimistic state, and
 * applies role-based edit permissions (a role may edit only when it is in the field's editable_by).
 */
export function useLeadCustomColumns({ role, fields, values }: UseLeadCustomColumnsArgs): LeadReportColumn[] {
  // Optimistic overrides keyed by `${leadId}:${fieldId}`.
  const [overrides, setOverrides] = useState<Map<string, string | null>>(new Map());

  const baseMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const v of values) map.set(`${v.lead_id}:${v.field_id}`, v.value);
    return map;
  }, [values]);

  const lookup = useCallback(
    (leadId: string, fieldId: string): string | null => {
      const key = `${leadId}:${fieldId}`;
      return overrides.has(key) ? overrides.get(key)! : (baseMap.get(key) ?? null);
    },
    [overrides, baseMap],
  );

  const onChange = useCallback(
    async (leadId: string, fieldId: string, value: string | null) => {
      const key = `${leadId}:${fieldId}`;
      const previous = overrides.has(key) ? overrides.get(key)! : (baseMap.get(key) ?? null);
      setOverrides((current) => new Map(current).set(key, value));
      try {
        await repository.upsertLeadCustomFieldValue(leadId, fieldId, value);
      } catch (reason) {
        setOverrides((current) => new Map(current).set(key, previous));
        toast.error(reason instanceof Error ? reason.message : "Could not save custom field.");
      }
    },
    [overrides, baseMap],
  );

  return useMemo(
    () =>
      fields.map((field) =>
        leadCustomFieldColumn(
          field,
          lookup,
          Boolean(role && field.editable_by.includes(role)),
          (leadId, fieldId, value) => void onChange(leadId, fieldId, value),
        ),
      ),
    [fields, lookup, role, onChange],
  );
}
