export { openDatabase } from './db.js'
export {registerDevice,listDevices,revokeDevice,createPairing,findPairing,getPairing,claimPairing,listPreferences,setPreference} from './pairing.js'
export type {DeviceRow,PairingRow,SyncedPreferenceRow} from './pairing.js'
export { MIGRATIONS } from './schema.js'
export type {
  Role,
  PartType,
  Rating,
  SessionRow,
  MessageRow,
  PartRow,
  NotebookRow,
  ScheduledTaskRow,
} from './types.js'

export {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
} from './sessions.js'

export {
  appendMessage,
  getMessage,
  listMessages,
  appendPart,
  updatePart,
  getPart,
  listParts,
  listSessionParts,
  setRating,
  getRating,
} from './messages.js'
