/**
 * @agentcontext/shared — domain types, Zod schemas, typed errors and shared
 * utilities. Implements the frozen contracts in docs/architecture/CONTRACTS.md.
 */
export const packageName = "@agentcontext/shared" as const;

export * from "./content.js";
export * from "./domain.js";
export * from "./errors.js";
export * from "./input.js";
export * from "./logs.js";
export * from "./markdown.js";
export * from "./result.js";
export * from "./results.js";
export * from "./retrieval.js";
export * from "./segments.js";
export * from "./text.js";
export * from "./validation.js";
