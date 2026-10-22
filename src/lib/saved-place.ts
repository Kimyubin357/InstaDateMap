import type { PlaceView } from "./place-view";

/** A server-confirmed place, scoped to the session that performed the write. */
export interface SavedPlace { boardId: string; authVersion: number; revision: string; place: PlaceView }
