import { safeEvent, type SafeEvent } from "../../../packages/domain/src/observability/events.js";
export function observe(event: SafeEvent): void { console.info(JSON.stringify(safeEvent(event))); }
