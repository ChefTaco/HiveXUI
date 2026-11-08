// The Conversation Room's visual scene. Prop-driven: the room page feeds it agents, a layout and
// real presence; nothing here fetches or invents activity.
export * from './model';
export { defaultRoomLayout, homeSeats, moveAgent, roomSeats } from './geometry';
export { ARC_HOLD_MS, excerpt, SPEAKING_HOLD_MS } from './presence';
export type { Presence } from './presence';
export { RoomScene, seatName, type RoomSceneProps } from './scene';
export { RoomRoster } from './roster';
export { RoomStage, type RoomStageProps } from './stage';
export { PortraitBadge, PortraitFigure } from './portrait';
