import { InMemoryStore } from "../../../persistence/src/index.js";

export class CommandExecutor {
  constructor(private readonly store: InMemoryStore) {}

  executeOnce<T>(params: {
    userId: string;
    commandType: string;
    idempotencyKey: string;
    run: () => T;
  }): T {
    const existing = this.store.findCommand(params.userId, params.idempotencyKey);
    if (existing?.status === "COMPLETED") {
      return existing.resultSummary as T;
    }
    const command = this.store.createCommand(
      params.userId,
      params.commandType,
      params.idempotencyKey
    );
    const result = params.run();
    command.status = "COMPLETED";
    command.appliedAt = this.store.now();
    command.resultSummary = result;
    return result;
  }
}
