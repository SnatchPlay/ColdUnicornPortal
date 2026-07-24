// Business validation — the rules that make a workflow WRONG even when it is structurally valid
// and runs fine today.
//
// The repository is the source of truth for business logic (ADR-0016).
// A workflow that contradicts an ADR is a defect in the workflow, never a reason to amend the ADR.
// These checks encode the contradictions we have actually hit, so they cannot silently return.

/**
 * Tables whose writes belong to an ingestion RPC contract (ADR-0015 §5, 11-integrations §6a).
 * Writing them directly from a Postgres node puts the invariant in an editable workflow instead of
 * the database — exactly what that ADR exists to prevent.
 */
const RPC_OWNED_TABLES = {
  leads: "promote_contact_to_lead (creation) — a CRM lead exists only after a positive reply",
  replies: "upsert_reply",
  ooo_followups: "record_ooo_followup / the mark_* / cancel_* transitions",
  sequencer_contacts: "upsert_sequencer_contact",
};

const WRITE_OPERATIONS = new Set(["insert", "update", "upsert", "delete", "insertOrUpdate"]);

/** ADR-0015: OOO/NRR are outreach states of a contact, never a lead qualification. */
const FORBIDDEN_QUALIFICATIONS = /^(OOO|NRR)$/;

/** Does this node change state somewhere? Used to decide whether a retry needs an idempotency key. */
function isWriteNode(node) {
  const operation = node.parameters?.operation;
  switch (node.type) {
    case "n8n-nodes-base.postgres":
      return WRITE_OPERATIONS.has(operation) || operation === "executeQuery";
    case "n8n-nodes-base.googleSheets":
      return ["append", "update", "appendOrUpdate", "delete"].includes(operation);
    case "n8n-nodes-base.dataTable":
      return ["insert", "update", "upsert", "deleteRows"].includes(operation);
    case "n8n-nodes-base.httpRequest": {
      const method = String(node.parameters?.method ?? "GET").toUpperCase();
      return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    }
    default:
      return false;
  }
}

function postgresNodes(workflow) {
  return (workflow.nodes ?? []).filter((node) => node.type === "n8n-nodes-base.postgres");
}

function tableOf(node) {
  const table = node.parameters?.table;
  return typeof table === "string" ? table : (table?.value ?? table?.cachedResultName ?? null);
}

/**
 * @param {object} workflow  canonical workflow.json
 * @param {object} manifest  manifest.yaml
 * @param {string} label
 */
export function validateBusinessRules(workflow, manifest, label) {
  const findings = [];
  const push = (severity, rule, message) => findings.push({ severity, rule, where: label, message });

  const processes = (manifest?.businessProcess ?? []).join(" ");
  const isOooProcess = /ooo|nrr/i.test(processes) || /ooo|nrr/i.test(manifest?.id ?? "");

  for (const node of postgresNodes(workflow)) {
    const operation = node.parameters?.operation;
    const table = tableOf(node);

    if (operation === "executeQuery") {
      const query = String(node.parameters?.query ?? "");
      for (const [name, contract] of Object.entries(RPC_OWNED_TABLES)) {
        const writes = new RegExp(`\\b(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${name}\\b`, "i");
        if (writes.test(query)) {
          push(
            "error",
            "business/direct-table-write",
            `Node "${node.name}" writes public.${name} with raw SQL. Use ${contract}.`,
          );
        }
      }
      continue;
    }

    if (!WRITE_OPERATIONS.has(operation) || !table) continue;

    const contract = RPC_OWNED_TABLES[table];
    if (contract) {
      push(
        "error",
        "business/direct-table-write",
        `Node "${node.name}" performs ${operation} on public.${table}. That table is written through ` +
          `an RPC contract: ${contract} (ADR-0015 §5).`,
      );
    }

    // Even via RPC, these two values must never be written as a lead qualification again.
    const columns = node.parameters?.columns?.value ?? {};
    const qualification = columns.qualification;
    if (typeof qualification === "string" && FORBIDDEN_QUALIFICATIONS.test(qualification.trim())) {
      push(
        "error",
        "business/ooo-as-qualification",
        `Node "${node.name}" sets leads.qualification = "${qualification.trim()}". ADR-0015 removed ` +
          "OOO/NRR from the lead funnel; record an ooo_followups episode instead.",
      );
    }
    if ("expected_return_date" in columns && table === "leads") {
      push(
        "error",
        "business/legacy-ooo-column",
        `Node "${node.name}" writes leads.expected_return_date, dropped by ` +
          "supabase/migrations/deferred/20260722z_drop_legacy_ooo_columns.sql.",
      );
    }
  }

  // ADR-0015 §2: a fallback date must never be written into expected_return_date, which is read as
  // a fact. A workflow in the OOO domain that computes `now + N days` into a field NAMED as the
  // expected return date is reproducing the exact bug the ADR calls out.
  if (isOooProcess) {
    for (const node of workflow.nodes ?? []) {
      const serialized = JSON.stringify(node.parameters ?? {});
      const fallbackIntoExpected =
        /"?Expected Return Date"?\s*:\s*"=?\{\{[^}]*\$now\.plus/i.test(serialized) ||
        /expected_return_date[^,}]*\$now\.plus/i.test(serialized);
      if (fallbackIntoExpected) {
        push(
          "error",
          "business/fallback-date-as-fact",
          `Node "${node.name}" writes a computed fallback ($now.plus) into an "expected return date" ` +
            "field. ADR-0015 §2: expected_return_date stays NULL when none was parsed; the fallback " +
            "belongs in scheduled_for, with date_source='fallback'.",
        );
      }
    }
  }

  // ADR-0017: a workflow may legitimately write two stores during the Sheets → Supabase transition,
  // but it must SAY SO. A dual-write nobody declared is the dangerous kind: no phase, no
  // authoritative source, no reconciliation, and no way to know which store to believe.
  const writesSheets = (workflow.nodes ?? []).some(
    (node) => node.type === "n8n-nodes-base.googleSheets" && isWriteNode(node),
  );
  const writesSupabase =
    postgresNodes(workflow).some((node) => isWriteNode(node)) ||
    (manifest?.writes?.rpcs?.length ?? 0) > 0;

  if (writesSheets && writesSupabase) {
    const transition = manifest?.transition;
    // `phase: 0` (sheets only) is a legitimate declared value — test for presence, not truthiness.
    const phase = transition?.phase;
    if (phase === undefined || phase === null || phase === "") {
      push(
        "error",
        "business/undeclared-dual-write",
        "Writes both Google Sheets and Supabase, but manifest.transition.phase is not declared " +
          "(ADR-0017). State the phase, the authoritative source and the reconciliation.",
      );
    } else if (!transition.authoritativeSource) {
      push(
        "error",
        "business/dual-write-no-authority",
        `transition.phase=${phase} but no authoritativeSource. During dual-write exactly ` +
          "one store is authoritative, and it must be written down.",
      );
    } else if (["A", "B"].includes(String(phase)) && !transition.reconciliation) {
      push(
        "warning",
        "business/dual-write-no-reconciliation",
        "Dual-write is active with no reconciliation declared. Divergence must be measured, not " +
          "assumed (ADR-0017 §5) — it is the entry condition for the next phase.",
      );
    }
  }

  if (manifest?.idempotency?.key === undefined) {
    push("warning", "business/idempotency-undocumented", "manifest.idempotency.key is not declared.");
  }

  // A retry is only dangerous when the retried node WRITES. Retrying a lookup is free, so flagging
  // it would train people to ignore this rule.
  const retryingWriters = (workflow.nodes ?? []).filter((node) => node.retryOnFail && isWriteNode(node));
  if (retryingWriters.length > 0 && !manifest?.idempotency?.key) {
    push(
      "error",
      "business/retry-without-idempotency",
      `Node(s) ${retryingWriters.map((node) => `"${node.name}"`).join(", ")} retry a WRITE but ` +
        "manifest.idempotency.key is not declared. A retry that duplicates a business record is a data defect.",
    );
  }

  return findings;
}

export { RPC_OWNED_TABLES };
