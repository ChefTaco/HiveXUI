// The Conversation Room's visual scene. Prop-driven: the room page feeds it agents, a layout and
// real presence; nothing here fetches or invents activity.
export * from './model';
export { defaultRoomLayout, homeSeats, moveAgent, roomSeats } from './geometry';
export { ARC_HOLD_MS, DELIVERY_HOLD_MS, emptyPresence, nextPresenceChange, presenceArcs, presenceOf, prunePresence, reducePresence, SPEAKING_HOLD_MS } from './presence';
export type { JournalEvent, Presence, PresenceEvent, PresenceState, PresenceTask } from './presence';
export { usePresenceNow } from './use-presence';
export { RoomScene, seatName, type RoomSceneProps } from './scene';
export { RoomRoster } from './roster';
export { RoomStage, type RoomStageProps } from './stage';
export { PortraitBadge, PortraitFigure } from './portrait';
