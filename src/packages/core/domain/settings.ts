// Keys and values are the strings stored in D1 (`settings` table): they stay in Spanish.
export const PHOTOS_MODE = "fotos.modo";
export const PHOTOS_REQUESTED_AT = "fotos.pedido_en";
export const BRAND_COLOR = "marca.color";
/** "1" when the cart offers advance orders (date, time, delivery or pickup). */
export const ADVANCE_ORDERS = "pedidos.anticipados";
/** The secret of the calendar feed URL (`/api/calendar/<token>.ics`); "" or absent: no link yet. */
export const CALENDAR_TOKEN = "calendario.token";
/** The shop's IANA time zone for the calendar feed, taken from the owner's browser when connecting. */
export const CALENDAR_TIME_ZONE = "calendario.zona";
export type SettingKey =
  | typeof PHOTOS_MODE
  | typeof PHOTOS_REQUESTED_AT
  | typeof BRAND_COLOR
  | typeof ADVANCE_ORDERS
  | typeof CALENDAR_TOKEN
  | typeof CALENDAR_TIME_ZONE;
