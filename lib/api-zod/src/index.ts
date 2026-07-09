export * from "./generated/api";
export * from "./generated/types";
// The names below are ambiguous because both ./generated/api (zod schema
// const) and ./generated/types (TS type) export them. Explicit re-exports
// here resolve the ambiguity by picking the zod schema (value + inferred
// type) as the canonical export.
export {
  DownloadReceiptPdfParams,
  SendManualReminderBody,
  UpdateReminderTemplateBody,
} from "./generated/api";
