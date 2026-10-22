// The assistant route streams plain text. If the reply fails part way, the
// server writes this marker and then a message for the user. The marker is a
// NUL character, which a model never writes, so it cannot be confused with
// reply text. Shared by the route and the browser, so keep it import-free.
export const CHAT_ERROR_MARKER = "\u0000";

/** The longest message the user may send. */
export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/** Only the newest turns are sent. Older ones fall out of the conversation. */
export const MAX_CHAT_TURNS = 20;
