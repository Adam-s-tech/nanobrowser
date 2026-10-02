// Stands in for `@ai-sdk/gateway` in the extension build.
// `ai` uses the Vercel AI Gateway as its default provider for string model IDs, so it imports the gateway
// statically and Vite would otherwise inline it (~65 KB). We always pass provider model instances.
const unsupported = (): never => {
  throw new Error('The AI Gateway is not available in the extension; pass a provider model instance');
};

// No error can come from the gateway, so the SDK's gateway error checks never match.
class GatewayErrorStub extends Error {
  static isInstance(): boolean {
    return false;
  }
}

export const GatewayError = GatewayErrorStub;
export const GatewayAuthenticationError = GatewayErrorStub;
export const createGateway = unsupported;
export const gateway = Object.assign(unsupported, {
  specificationVersion: 'v4',
  languageModel: unsupported,
  embeddingModel: unsupported,
  imageModel: unsupported,
});
