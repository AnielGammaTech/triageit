/**
 * Well-known Microsoft identifiers used by the one-button Microsoft 365 setup.
 * See docs/superpowers/specs/2026-07-10-dispatch-board-design.md (Component 0).
 */

/** "Microsoft Graph Command Line Tools" — well-known public client that every
 *  tenant already trusts for delegated device-code sign-in. Used ONLY during
 *  setup; its delegated token is never stored. */
export const DEVICE_CODE_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

/** Microsoft Graph resource (first-party service principal appId). */
export const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";

/** Graph application role `Calendars.ReadWrite` — the only permission the
 *  provisioned TriageIT Calendar app is granted. */
export const CALENDARS_READWRITE_ROLE_ID = "ef54d2bf-783f-4e0f-bca1-3210c0444d99";

/** Delegated scopes the admin consents to during device-code sign-in — enough
 *  to create the app registration and grant it admin consent, nothing more. */
export const SETUP_SCOPES =
  "https://graph.microsoft.com/Application.ReadWrite.All https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All";

export const LOGIN_BASE_URL = "https://login.microsoftonline.com";
export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

export const PROVISIONED_APP_DISPLAY_NAME = "TriageIT Calendar";

/** Client secret lifetime for the provisioned app (24 months per spec). */
export const SECRET_LIFETIME_MONTHS = 24;
