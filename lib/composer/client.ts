import { createComposeSdk } from "@lifi/composer-sdk";

export const createCircuitBreakerComposeSdk = ({
  apiKey,
  baseUrl
}: {
  apiKey: string;
  baseUrl: string;
}) =>
  createComposeSdk({
    apiKey,
    baseUrl
  });
