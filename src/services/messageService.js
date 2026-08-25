// Phase 1: thin pass-through to DataContext. Phase 2: swap for Supabase +
// Realtime so messages appear without a page refresh.
export function createMessageService(data) {
  return {
    list: () => data.db.messages,
    conversations: () => data.db.conversations,
    getOrCreateConversation: (userId) => data.getOrCreateConversation(userId),
    send: (payload) => data.sendMessage(payload),
    markRead: (conversationId) => data.markMessagesRead(conversationId),
  };
}
