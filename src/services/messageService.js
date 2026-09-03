// Supabase-backed 1:1 messaging (conversations + messages).
//
// RLS is the boundary (migration 20260825190000):
//   * conversations_select : auth.uid() in (participant_1_id, participant_2_id)
//   * messages_select      : caller is a participant of the message's conversation
//   * messages_insert      : sender_id = auth.uid() AND caller is a participant
//   * messages_update      : any participant (the recipient flips `read`); the
//                            enforce_message_update_guard trigger allows only the `read` column
//   * conversations have NO direct INSERT policy -- get_or_create_conversation() (SECURITY
//     DEFINER, hardened to require the caller be one of the pair) is the only creation path.
//
// The recipient notification is done by notify_message (SECURITY DEFINER, idempotent per
// message id, recipient derived server-side).
//
// Rows are returned in the shape consumers expect: conversation -> { id, participantIds: [p1, p2] };
// message -> { id, conversationId, senderId, text, read, createdAt }.
import { supabase } from "../lib/supabaseClient";

function mapConversation(row) {
  return { id: row.id, participantIds: [row.participant_1_id, row.participant_2_id] };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    text: row.text,
    read: !!row.read,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

export function createMessageService() {
  return {
    async listConversations() {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapConversation);
    },

    // All messages the caller can see (RLS-scoped to their conversations). Bounded -- the UI
    // renders per-conversation threads from this pool.
    async listMessages(limit = 1000) {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data || []).map(mapMessage);
    },

    // get_or_create_conversation(user_a, user_b) -> uuid. Returns the existing conversation for
    // the (unordered) pair, or creates it. Hardened: raises if the caller is not one of the pair.
    async getOrCreateConversation(userA, userB) {
      const { data, error } = await supabase.rpc("get_or_create_conversation", {
        user_a: userA,
        user_b: userB,
      });
      if (error) throw error;
      return data;
    },

    async send({ conversationId, senderId, text }) {
      const { data, error } = await supabase
        .from("messages")
        .insert({ conversation_id: conversationId, sender_id: senderId, text })
        .select()
        .single();
      if (error) throw error;
      return mapMessage(data);
    },

    // notify_message(p_message_id, p_title, p_message, p_navigation) -- one notification per
    // message id, recipient = the other participant, derived server-side.
    async notify(messageId, { title, message } = {}) {
      const { error } = await supabase.rpc("notify_message", {
        p_message_id: messageId,
        p_title: title || "New message",
        p_message: message || "",
        p_navigation: { page: "messages" },
      });
      if (error) throw error;
    },

    // The recipient marks the sender's messages in a thread read. RLS + the guard trigger keep
    // this to the `read` column on conversations the caller belongs to.
    async markRead(conversationId, selfId) {
      const { error } = await supabase
        .from("messages")
        .update({ read: true })
        .eq("conversation_id", conversationId)
        .neq("sender_id", selfId)
        .eq("read", false);
      if (error) throw error;
    },
  };
}
