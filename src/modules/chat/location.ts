export type ChatLocation = { team: string; channel: string; thread: string };
const id = (value: string | null) =>
  value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : "";
export function readChatLocation(search: string): ChatLocation {
  const params = new URLSearchParams(search);
  const channel = id(params.get("chatChannel"));
  return {
    team: id(params.get("chatTeam")),
    channel,
    thread: channel ? id(params.get("chatThread")) : "",
  };
}
export function writeChatLocation(url: URL, selected: ChatLocation): URL {
  const result = new URL(url);
  for (const [key, value] of Object.entries({
    chatTeam: selected.team,
    chatChannel: selected.channel,
    chatThread: selected.channel ? selected.thread : "",
  })) {
    if (value) result.searchParams.set(key, value);
    else result.searchParams.delete(key);
  }
  return result;
}
// A channel can have several concurrent views. A later refresh must win even in the same thread.
export class ChatViewRequests {
  private sequence = 0;
  begin() {
    return ++this.sequence;
  }
  current(sequence: number) {
    return sequence === this.sequence;
  }
  invalidate() {
    ++this.sequence;
  }
}
