import { useEffect, useState, type FormEvent } from "react";
import { HiveSigil } from "../../components/icons";
import { productEnabled } from "../../lib/runtime";
import { chatServerAddress, readInviteCode, redeemInvite } from "./invite";
import { buttonClass, Button, CopyField, Field, TextInput } from "@ui";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="honeycomb-bg" aria-hidden />
      <main className="login-shell">
        <section className="login-card" aria-labelledby="chat-invite-title">
          <HiveSigil className="login-sigil" />
          <p className="login-eyebrow">ChatterMost</p>
          <h1 id="chat-invite-title">{title}</h1>
          {children}
        </section>
      </main>
    </>
  );
}
const SignIn = () => (
  <a className={buttonClass({ variant: 'ghost' })} href="/">
    Back to console sign-in
  </a>
);

export default function InviteRedemption() {
  const [invite, setInvite] = useState(() => readInviteCode(location)),
    [username, setUsername] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [created, setCreated] = useState("");
  useEffect(() => {
    // The code is a one-use credential: keep it out of history and copied addresses.
    if (location.search || location.hash)
      history.replaceState(null, "", location.pathname);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await redeemInvite({
        invite_code: invite,
        username,
        email: email.trim(),
        password,
      });
      setCreated(user.username);
      setInvite("");
      setPassword("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The invite could not be redeemed.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!productEnabled("chattermost"))
    return (
      <Card title="Chat is not installed">
        <p className="login-sub">This console has no chat service to join.</p>
        <SignIn />
      </Card>
    );
  if (created)
    return (
      <Card title="Chat account created">
        <p className="login-sub">
          @{created} can sign in to Mattermost-compatible apps now, using the
          password you chose and this server address.
        </p>
        <CopyField
          value={chatServerAddress(location.origin)}
          label="Copy server address"
        />
        <p>
          This console signs in through Oathweave. To use chat here, ask your
          administrator for an Oathweave account linked to @{created}.
        </p>
        <SignIn />
      </Card>
    );
  return (
    <Card title="Join ChatterMost">
      <p className="login-sub">
        Your invite creates a chat account with its own password. It does not
        create an Oathweave account.
      </p>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        {error ? (
          <p role="alert" className="error-banner">
            {error}
          </p>
        ) : null}
        <Field label="Invite code">
          <TextInput
            required
            autoComplete="off"
            spellCheck={false}
            value={invite}
            onChange={setInvite}
          />
        </Field>
        <Field label="Email">
          <TextInput
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />
        </Field>
        <Field label="Username">
          <TextInput
            required
            minLength={2}
            autoCapitalize="none"
            autoComplete="username"
            spellCheck={false}
            value={username}
            onChange={setUsername}
          />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <TextInput
            required
            minLength={10}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
        </Field>
        <Button variant="primary" type="submit" loading={busy}>
          Create chat account
        </Button>
      </form>
      <SignIn />
    </Card>
  );
}
