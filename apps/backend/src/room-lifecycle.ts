export type SocketState = { readyState: number };

const SOCKET_OPEN = 1;
export const EMPTY_ROOM_GRACE_MS = 30_000;

export function hasActiveRoomSockets<T extends SocketState>(sockets: readonly T[], ignored?: T): boolean {
  return sockets.some((socket) => socket !== ignored && socket.readyState === SOCKET_OPEN);
}

export async function cleanupEmptyRoom<T extends SocketState>(options: {
  sockets: readonly T[];
  roomCode?: string;
  deleteRoom: (roomCode: string) => Promise<void>;
  clearState: () => Promise<void>;
}): Promise<boolean> {
  if (hasActiveRoomSockets(options.sockets)) return false;
  if (options.roomCode) await options.deleteRoom(options.roomCode);
  await options.clearState();
  return true;
}
