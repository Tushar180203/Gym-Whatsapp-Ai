import type { StructuredOutputClient, StructuredOutputRequest, StructuredOutputResponse } from "../interfaces.js";

export class MockStructuredOutputClient implements StructuredOutputClient {
  readonly requests: StructuredOutputRequest[] = [];

  constructor(private readonly outputs: unknown[] = []) {}

  enqueue(output: unknown): void {
    this.outputs.push(output);
  }

  async createStructuredOutput(request: StructuredOutputRequest): Promise<StructuredOutputResponse> {
    this.requests.push(request);
    if (this.outputs.length === 0) {
      throw new Error("MockStructuredOutputClient has no queued output");
    }
    return {
      rawJson: this.outputs.shift(),
      model: request.model,
      providerRequestId: `mock-${this.requests.length}`
    };
  }
}
