import { expect, it } from "vitest";
import {
  ChatViewRequests,
  readChatLocation,
  writeChatLocation,
} from "./location";
it("preserves valid conversation links and rejects paths, credentials and orphan threads", () => {
  expect(
    readChatLocation("?chatTeam=team-1&chatChannel=chan_1&chatThread=post1"),
  ).toEqual({ team: "team-1", channel: "chan_1", thread: "post1" });
  expect(readChatLocation("?chatChannel=..%2Fadmin&chatThread=post1")).toEqual({
    team: "",
    channel: "",
    thread: "",
  });
  expect(
    readChatLocation(
      "?chatChannel=https%3A%2F%2Fexample.com&chatThread=secret",
    ),
  ).toEqual({ team: "", channel: "", thread: "" });
});
it("updates only chat navigation and removes obsolete thread selections", () => {
  const url = writeChatLocation(
    new URL(
      "https://console.example.com/?page=chat&theme=dark&chatThread=old#view",
    ),
    { team: "team", channel: "", thread: "orphan" },
  );
  expect(url.searchParams.get("page")).toBe("chat");
  expect(url.searchParams.get("theme")).toBe("dark");
  expect(url.searchParams.has("chatThread")).toBe(false);
  expect(url.hash).toBe("#view");
});
it("rejects stale responses after switching threads, superseding refreshes or leaving a view", () => {
  const requests = new ChatViewRequests();
  const old = requests.begin(),
    next = requests.begin();
  expect(requests.current(old)).toBe(false);
  expect(requests.current(next)).toBe(true);
  requests.invalidate();
  expect(requests.current(next)).toBe(false);
});
