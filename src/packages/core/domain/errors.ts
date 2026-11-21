export type ErrorCode =
  | "INVALID_PRICE"
  | "NO_IMAGE"
  | "EMPTY_NAME"
  | "INVALID_SLUG"
  | "INVALID_IMAGE"
  | "TOO_MANY_IMAGES"
  | "PRODUCT_PAUSED"
  | "PRODUCT_NOT_FOUND"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_HAS_PRODUCTS"
  | "INVALID_STATUS"
  // Same code the API answers for invalid input (validation.ts); the AI tools return it too.
  | "INVALID_INPUT"
  | "INVALID_CODE"
  | "STORE_ALREADY_CLAIMED"
  | "CHALLENGE_EXPIRED"
  | "PASSKEY_NOT_VERIFIED"
  | "UNKNOWN_PASSKEY"
  | "PASSKEY_ALREADY_REGISTERED"
  | "ORIGIN_NOT_ALLOWED"
  | "NOT_AUTHENTICATED"
  | "ACCESS_LIMITED"
  | "TOO_MANY_ATTEMPTS"
  | "LAST_PASSKEY"
  | "INVALID_WHATSAPP"
  | "INVALID_TRANSFER"
  | "INVALID_STEP"
  | "INVALID_LANGUAGE"
  | "DESCRIPTION_TOO_LONG"
  | "INVALID_BRAND_COLOR"
  | "GITHUB_NOT_CONNECTED"
  | "GITHUB_NOT_RESPONDING"
  | "GITHUB_MULTIPLE_REPOSITORIES"
  | "ALREADY_UP_TO_DATE"
  | "INVALID_CART"
  | "PRODUCT_UNAVAILABLE"
  | "INVALID_OPTIONS"
  | "INVALID_SELECTION"
  | "INVALID_DOMAIN"
  | "DOMAIN_NOT_DELEGATED"
  | "DOMAIN_IN_USE"
  | "ROUTES_ALREADY_SET"
  | "DNS_NOT_RESPONDING"
  | "IMAGE_QUOTA_REACHED"
  | "PRO_REQUIRED"
  | "PRODUCT_LIMIT_REACHED"
  | "HOSTING_NOT_RESPONDING"
  | "R2_ALREADY_SET"
  | "ORDER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_ORDER"
  | "WEAK_PASSWORD";

export type DomainError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export function domainError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return details === undefined ? { code, message } : { code, message, details };
}
