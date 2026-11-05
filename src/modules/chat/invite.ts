import { z } from "zod";
import { mattermostUserSchema } from "../../../contracts/chattermost-chat.generated";
import { productPrefix } from "../../lib/transport";

/**
 * Redeeming an invite is anonymous: the person has no Oathweave identity yet, and this must
 * never start a sign-in. It mirrors ChatterMost's public signup route, which the released
 * browser contract does not list yet, and creates a native account with its own password.
 * It does not sign in or link an identity: console access stays a reviewed, explicit link.
 */
export const inviteRedemptionSchema = z.object({
  invite_code: z.string().trim().min(1, "Enter your invite code."),
  username: z
    .string()
    .trim()
    .min(2, "Choose a username of at least 2 characters.")
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "Usernames use lowercase letters, numbers, dots, dashes and underscores, and start with a letter or number.",
    ),
  email: z.email("Enter a valid email address."),
  password: z.string().min(10, "Choose a password of at least 10 characters."),
});
export type InviteRedemption = z.input<typeof inviteRedemptionSchema>;

export async function redeemInvite(
  input: InviteRedemption,
  request: typeof fetch = (...args) => fetch(...args),
) {
  const parsed = inviteRedemptionSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "Check the form.");
  const prefix = productPrefix("chattermost");
  if (!prefix) throw new Error("Chat is not installed on this console.");
  const response = await request(prefix + "/api/v4/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = z.object({ message: z.string() }).safeParse(body);
    throw new Error(
      failure.success
        ? failure.data.message
        : "The invite could not be redeemed. Try again in a moment.",
    );
  }
  const user = mattermostUserSchema.safeParse(body);
  if (!user.success)
    throw new Error(
      "Your account may have been created, but Chat returned an unexpected response. Ask your administrator to check before trying again.",
    );
  return user.data;
}

/** Links carry the code in the fragment, so it stays out of server and proxy logs. */
export const inviteLink = (origin: string, code: string) =>
  origin + "/signup#invite=" + encodeURIComponent(code);
/** Also accepts `?invite=`, the form native ChatterMost's signup page reads. */
export function readInviteCode(where: { search: string; hash: string }) {
  const fragment = new URLSearchParams(where.hash.replace(/^#/, ""));
  return (
    fragment.get("invite") ?? new URLSearchParams(where.search).get("invite") ?? ""
  );
}
export const chatServerAddress = (origin: string) =>
  origin + (productPrefix("chattermost") ?? "");
