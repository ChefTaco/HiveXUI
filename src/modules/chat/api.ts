import { chatBrowserResponseSchema,chatBrowserRequestSchema } from "../../../contracts/chattermost-chat.generated";
import { apiFetch, productPrefix } from "../../lib/transport";

export async function chat<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const schema=chatBrowserResponseSchema(path,init.method??"GET");
  if(typeof init.body==='string') {
    const requestSchema=chatBrowserRequestSchema(path,init.method??"GET");
    if(requestSchema && !requestSchema.safeParse(JSON.parse(init.body)).success)throw new Error("Chat request does not match the product contract");
  }
  const response = await apiFetch("/api/chat/api/v4" + path, init);
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    throw new Error(
      error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
        ? error.message
        : "Chat could not complete this request",
    );
  }
  const parsed=schema.safeParse(await response.json());
  if(!parsed.success)throw new Error("Chat returned an unsupported response; check the product release before retrying.");
  return parsed.data as T;
}
export const json = (body: object, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const safeId = (id: string) => encodeURIComponent(id);
// Native session cookies authorize these same-origin resources; URLs never carry tokens.
export const chatResource = (path: string) =>
  (productPrefix("chattermost") ?? "/api/chat") + "/api/v4" + path;
