import { AgentContextError, type CompressionStrategy } from "@agentcontext/shared";

/** Ordered set of available strategies. Registration order breaks selection ties. */
export class StrategyRegistry {
  readonly #strategies = new Map<string, CompressionStrategy>();

  constructor(strategies: Iterable<CompressionStrategy> = []) {
    for (const strategy of strategies) this.register(strategy);
  }

  register(strategy: CompressionStrategy): this {
    if (!strategy.name || strategy.name === "passthrough") {
      throw new AgentContextError("INVALID_INPUT", "Invalid strategy name", {
        strategy: strategy.name,
      });
    }
    if (this.#strategies.has(strategy.name)) {
      throw new AgentContextError("INVALID_INPUT", "Strategy is already registered", {
        strategy: strategy.name,
      });
    }
    this.#strategies.set(strategy.name, strategy);
    return this;
  }

  has(name: string): boolean {
    return this.#strategies.has(name);
  }

  get(name: string): CompressionStrategy {
    const strategy = this.#strategies.get(name);
    if (!strategy) {
      throw new AgentContextError("INVALID_INPUT", "Unknown strategy", {
        strategy: name,
        available: this.names(),
      });
    }
    return strategy;
  }

  names(): string[] {
    return [...this.#strategies.keys()];
  }

  list(): CompressionStrategy[] {
    return [...this.#strategies.values()];
  }
}
