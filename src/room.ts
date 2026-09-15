import { DuelRoom as HttpRoom, roomFromHash } from './http-room';
import { DuelRoom as PeerRoom } from './network';
export const HTTPS_ROOMS = import.meta.env.MODE === 'https';
export const DuelRoom = HTTPS_ROOMS ? HttpRoom : PeerRoom;
export type DuelRoom = InstanceType<typeof DuelRoom>;
export { roomFromHash };
