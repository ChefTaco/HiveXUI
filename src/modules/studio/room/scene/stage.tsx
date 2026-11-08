// The room as the Conversation Room page will mount it: the scene, a roster list that can be shown
// or hidden and stays in step with it, and a polite live region for state changes.
import { useId, useState, type ReactNode } from 'react';
import { List } from 'lucide-react';
import { Button } from '@ui';
import { useRoomAnnouncements } from './live';
import { RoomRoster } from './roster';
import { RoomScene, type RoomSceneProps } from './scene';

export interface RoomStageProps extends RoomSceneProps {
  /** Whether the roster starts open. */
  rosterOpen?: boolean;
  /** Controls the page adds beside the roster toggle, such as layout editing. */
  actions?: ReactNode;
}

export function RoomStage({ rosterOpen: initiallyOpen = false, actions, ...scene }: RoomStageProps) {
  const [rosterOpen, setRosterOpen] = useState(initiallyOpen);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const announcement = useRoomAnnouncements(scene.agents);
  const rosterId = useId();
  const active = scene.activeRef !== undefined ? scene.activeRef : activeRef;
  const onActiveChange = (ref: string) => {
    setActiveRef(ref);
    scene.onActiveChange?.(ref);
  };
  return (
    <div className="room-stage">
      <div className="room-stage__bar">
        {actions}
        <Button size="sm" icon={<List className="btn-ico" aria-hidden="true" />} aria-expanded={rosterOpen} aria-controls={rosterId} onClick={() => setRosterOpen((open) => !open)}>
          {rosterOpen ? 'Hide roster' : 'Show roster'}
        </Button>
      </div>
      <div className="room-stage__body">
        <RoomScene {...scene} activeRef={active} onActiveChange={onActiveChange} />
        <div className="room-stage__roster" hidden={!rosterOpen}>
          <RoomRoster id={rosterId} agents={scene.agents} activeRef={active} onSelect={scene.onSelect} onActiveChange={onActiveChange} />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-room-live="">
        {announcement}
      </p>
    </div>
  );
}
