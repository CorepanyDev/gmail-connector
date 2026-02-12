export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiConfig {
  port: number;
  apiKey: string;
  credentialsPath: string;
  tokenPath: string;
  verbose: boolean;
}
