export interface LocalAiModel {
  id: string;
  name: string;
  efforts?: string[];
}

export interface LocalAiProviderStatus {
  connected: boolean;
  sharing?: boolean;
  connecting?: boolean;
  account?: string;
  accountId?: string;
  models: LocalAiModel[];
  error?: string;
}

export interface LocalAiPlanInput {
  model: string;
  effort?: string;
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
}

export interface LocalAiProvider {
  status(): Promise<LocalAiProviderStatus>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  plan(input: LocalAiPlanInput): Promise<{ text: string; model: string }>;
  dispose?(): void | Promise<void>;
}

/** Only this bounded code is returned across the local HTTP boundary. */
export class LocalAiProviderError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "LocalAiProviderError";
  }
}
