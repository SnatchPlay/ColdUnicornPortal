// Migration-only deployable twin of `orm-gateway`.
//
// During the snapshot → per-page data-contract migration we want work-in-progress gateway changes
// to be testable WITHOUT redeploying the production `orm-gateway` function. This entrypoint simply
// re-imports the single source of truth, so there is no code duplication — `orm-gateway-next` and
// `orm-gateway` run identical code. The isolation comes from DEPLOYMENT: deploy `orm-gateway-next`
// with the new code while leaving the already-deployed `orm-gateway` untouched, and point the dev
// frontend at it via VITE_ORM_GATEWAY_FUNCTION=orm-gateway-next.
//
// At the Phase 8 cutover, deploy the reviewed code to `orm-gateway`, drop the env override, and
// delete this directory.
import "../orm-gateway/index.ts";
