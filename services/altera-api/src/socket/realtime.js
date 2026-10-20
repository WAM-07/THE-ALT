const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const core = require('../services/core_client');
const { storeImageDataUri, storeMediaDataUri } = require('../services/media_storage');

const connectedUsers = new Map();

function makeParticipantKey(profileId, profileType) {
  return `${profileType}:${profileId}`;
}

function getConversationId(profileAId, profileAType, profileBId, profileBType) {
  return [
    makeParticipantKey(profileAId, profileAType),
    makeParticipantKey(profileBId, profileBType),
  ].sort().join('|');
}

async function saveMediaDataUrl(mediaUrl, ownerId) {
  if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.startsWith('data:')) {
    return mediaUrl;
  }

  if (mediaUrl.startsWith('data:image')) {
    return (
      await storeImageDataUri({
        userId: ownerId,
        dataUri: mediaUrl,
        purpose: 'dm',
      })
    ) || mediaUrl;
  }

  if (mediaUrl.startsWith('data:audio') || mediaUrl.startsWith('data:video')) {
    return (
      await storeMediaDataUri({
        userId: ownerId,
        dataUri: mediaUrl,
        purpose: 'dm',
      })
    ) || mediaUrl;
  }

  return mediaUrl;
}

function detectMediaType(mediaUrl) {
  if (typeof mediaUrl !== 'string' || mediaUrl.trim().length === 0) {
    return null;
  }

  if (mediaUrl.startsWith('data:audio/')) return 'audio';
  if (mediaUrl.startsWith('data:video/')) return 'video';
  if (mediaUrl.startsWith('data:image/')) return 'image';
  if (/\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i.test(mediaUrl)) return 'audio';
  if (/\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(mediaUrl)) return 'video';
  return 'image';
}

function buildNotificationMessage({ content, mediaUrl, mediaType }) {
  if (typeof content === 'string' && content.startsWith('[[POST_SHARE]]')) {
    return 'shared a post with you.';
  }

  if (mediaUrl) {
    if (mediaType === 'audio') return 'sent you a voice note.';
    if (mediaType === 'video') return 'sent you a video.';
    if (/\.(mp3|wav|m4a|aac|ogg)$/i.test(mediaUrl)) return 'sent you a voice note.';
    if (/\.(mp4|mov|m4v|webm)$/i.test(mediaUrl)) return 'sent you a video.';
    return 'sent you an image.';
  }

  return 'sent you a message.';
}

function isAudioUrl(mediaUrl) {
  return (
    typeof mediaUrl === 'string' &&
    (mediaUrl.startsWith('data:audio/') ||
      /\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i.test(mediaUrl))
  );
}

/**
 * Saves a direct message, keeps its conversation up to date, tells the receiver, and returns the
 * message as the app expects it. Used for people and for AI replies alike.
 */
// Categories of ALT's rules that block a person's private message outright. Self-harm is not among them: someone
// writing about it privately may be reaching out for help, and blocking that would do harm.
const DM_BLOCKING_RULES = ['violence', 'hate', 'sexual_minors'];

/** ALT Core's safety check (rules and the toxicity model) applied with the direct-message policy. */
async function dmSafety(content, senderIsAi) {
  let r;
  try {
    r = await core.moderate(content);
  } catch {
    return { block: false, warn: false, categories: [] }; // Core unreachable: deliver, as before
  }
  const categories = (r.categories || []).filter((c) => senderIsAi || !['private_data', 'impersonation', 'self_harm'].includes(c));
  // An AI's messages follow the rules for everything an AI says: anything flagged is blocked.
  if (senderIsAi) return { block: categories.length > 0, warn: false, categories };
  if (r.level === 'severe' || categories.some((c) => DM_BLOCKING_RULES.includes(c))) return { block: true, warn: false, categories };
  if (r.level === 'toxic' || r.level === 'mild') return { block: false, warn: true, categories: categories.length ? categories : ['toxicity'] };
  return { block: false, warn: false, categories: [] };
}

async function deliverDm(io, { senderUserId, senderProfileId, senderType, senderInfo, receiverId, receiverType, receiverInfo, content, mediaUrl, mediaType }) {
  const conversationId = getConversationId(
    senderProfileId,
    senderType,
    receiverId,
    receiverType
  );

  const messageId = uuidv4();
  const createdAt = new Date().toISOString();

  const receiverUserId = receiverType === 'ai' ? receiverInfo.user_id : receiverInfo.id;

  // Persist to DB
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_id, sender_profile_id, sender_type, recipient_id, recipient_profile_id, recipient_type, content, media_url, media_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      messageId,
      conversationId,
      senderUserId,
      senderProfileId,
      senderType,
      receiverUserId,
      receiverId,
      receiverType,
      content,
      mediaUrl || null,
      mediaType,
      createdAt
    ]
  );

  // ─── Ensure Conversation Exists (canonical ordering) ───
  try {
    const key1 = makeParticipantKey(senderProfileId, senderType);
    const key2 = makeParticipantKey(receiverId, receiverType);
    const profile1IsFirst = key1 < key2;

    const user1Id   = profile1IsFirst ? senderUserId     : receiverUserId;
    const user2Id   = profile1IsFirst ? receiverUserId    : senderUserId;
    const p1Id      = profile1IsFirst ? senderProfileId   : receiverId;
    const p2Id      = profile1IsFirst ? receiverId        : senderProfileId;
    const p1Type    = profile1IsFirst ? senderType        : receiverType;
    const p2Type    = profile1IsFirst ? receiverType      : senderType;

    await db.query(
      `INSERT INTO conversations (id, user1_id, user2_id, profile1_id, profile2_id, profile1_type, profile2_type, last_message_id, last_message_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (id) DO UPDATE SET 
         last_message_id = EXCLUDED.last_message_id,
         last_message_at = EXCLUDED.last_message_at,
         updated_at = EXCLUDED.updated_at,
         is_archived = FALSE`,
      [
        conversationId,
        user1Id, user2Id,
        p1Id, p2Id,
        p1Type, p2Type,
        messageId,
        createdAt
      ]
    );
  } catch (e) {
    console.error('[Socket Conversation Sync Error]', e);
  }

  // ─── Create Notification ───
  try {
    if (receiverUserId !== senderUserId) {
      const notificationId = uuidv4();
      const notificationMessage = buildNotificationMessage({
        content,
        mediaUrl: mediaUrl,
        mediaType,
      });
      // We no longer insert 'message' notifications into the DB to keep the Notification List clean (Messages only in Inbox)
      // But we still emit the real-time event for UI updates
      io.to(`notifications:${receiverUserId}`).emit(
        'notification:new',
        {
          id: notificationId,
          user_id: receiverUserId,
          actor_id: senderUserId,
          actor_name: senderInfo.display_name,
          actor_avatar: senderInfo.avatar,
          type: 'message',
          post_id: null,
          comment_id: null,
          post_snippet: null,
          message: notificationMessage,
          is_read: false,
          read_at: null,
          created_at: createdAt,
        },
      );
    }
  } catch (e) { console.error('[DM Notif Error]', e); }

  const messageResponse = {
    id: messageId,
    conversation_id: conversationId,
    sender_id: senderProfileId,
    sender_user_id: senderUserId,
    sender_profile_id: senderProfileId,
    sender_profile_type: senderType,
    sender_name: senderInfo.display_name,
    sender_username: senderInfo.username,
    sender_avatar_url: senderInfo.avatar,
    sender_is_verified: !!senderInfo.is_verified,
    sender_is_ai: senderType === 'ai',
    receiver_id: receiverId,
    receiver_user_id: receiverUserId,
    receiver_profile_id: receiverId,
    receiver_profile_type: receiverType,
    receiver_name: receiverInfo.display_name,
    receiver_username: receiverInfo.username,
    receiver_avatar_url: receiverInfo.avatar,
    receiver_is_verified: !!receiverInfo.is_verified,
    receiver_is_ai: receiverType === 'ai',
    content,
    media_url: mediaUrl || null,
    media_type: mediaType,
    created_at: createdAt,
    is_read: false,
  };

  io.to(`user:${messageResponse.receiver_user_id}`).emit('dm:receive', messageResponse);
  return messageResponse;
}

/** A verified AI with autonomy on replies in its own voice, through ALT Core's persona engine. */
async function maybeAiAutoReply(io, { aiProfileId, humanUserId, conversationId }) {
  const ai = await db.queryOne(
    'SELECT id, user_id, username, display_name, avatar, is_verified, autonomy_enabled, core_ai_id FROM ai_profiles WHERE id = $1',
    [aiProfileId]
  );
  if (!ai || !ai.is_verified || !ai.autonomy_enabled || !ai.core_ai_id || ai.user_id === humanUserId) return null;
  const human = await db.queryOne(
    'SELECT id, username, full_name as display_name, avatar_url as avatar, is_verified FROM users WHERE id = $1',
    [humanUserId]
  );
  if (!human) return null;
  const history = await db.queryMany(
    `SELECT sender_type, content FROM messages
      WHERE conversation_id = $1 AND is_unsended = FALSE AND content IS NOT NULL AND content <> ''
      ORDER BY created_at DESC LIMIT 10`,
    [conversationId]
  );
  const messages = history.reverse().map((m) => ({ role: m.sender_type === 'ai' ? 'assistant' : 'user', content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  const reply = await core.respond(ai.core_ai_id, 'altera_dm', messages, humanUserId);
  if (!reply || !reply.text) return null;
  return deliverDm(io, {
    senderUserId: ai.user_id,
    senderProfileId: ai.id,
    senderType: 'ai',
    senderInfo: ai,
    receiverId: humanUserId,
    receiverType: 'human',
    receiverInfo: human,
    content: reply.text,
    mediaUrl: null,
    mediaType: null,
  });
}

function setupSocketIO(io) {
  // A signed-out session must not keep a live socket.
  const { onSessionRevoked, isSessionActive } = require('../middleware/auth');
  onSessionRevoked(async ({ sessionId, userId }) => {
    for (const socket of io.sockets.sockets.values()) {
      if (sessionId && socket.sessionId === sessionId) {
        socket.disconnect(true);
      } else if (!sessionId && userId && socket.userId === userId && !(await isSessionActive(socket.sessionId, userId))) {
        socket.disconnect(true);
      }
    }
  });

  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const { authenticate, ensureProfile } = require('../middleware/auth');
      const payload = await authenticate(token);
      await ensureProfile(payload.userId);
      socket.userId = payload.userId;
      socket.sessionId = payload.sessionId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.userId} (${socket.id})`);
    connectedUsers.set(socket.userId, socket.id);
    socket.join(`user:${socket.userId}`);

    socket.on('subscribe:feed', () => {
      socket.join('feed:live');
      socket.emit('subscribed', { channel: 'feed:live' });
    });

    socket.on('subscribe:notifications', () => {
      socket.join(`notifications:${socket.userId}`);
    });

    socket.on('subscribe:post', (postId) => {
      if (postId) {
        socket.join(`post:${postId}`);
        console.log(`[Socket] User ${socket.userId} joined post room: ${postId}`);
      }
    });

    socket.on('dm:send', async (data) => {
      try {
        const content = `${data?.content || ''}`.trim();
        const mediaType = data?.media_type || detectMediaType(data?.media_url);
        const resolvedMediaUrl = await saveMediaDataUrl(data?.media_url, socket.userId);
        if (!content && !resolvedMediaUrl) {
          return socket.emit('dm:error', { message: 'Message content or media is required' });
        }

        // Never log what a private message says.
        console.log(`[Socket DM] From ${socket.userId} to ${data?.receiver_id} (${data?.receiver_type})`);
        if (content.startsWith('[[POST_SHARE]]')) {
          console.log('[Socket DM] SHARED POST DETECTED');
        }

        const senderProfileId = data?.sender_profile_id;
        const senderType = data?.sender_type || 'human';
        if (!senderProfileId) {
          return socket.emit('dm:error', { message: 'Sender profile is required' });
        }

        // Fetch sender info from DB
        let senderInfo;
        if (senderType === 'ai') {
          senderInfo = await db.queryOne('SELECT id, user_id, username, display_name, avatar, is_verified FROM ai_profiles WHERE id = $1 AND user_id = $2', [senderProfileId, socket.userId]);
        } else {
          senderInfo = await db.queryOne('SELECT id, username, full_name as display_name, avatar_url as avatar, is_verified FROM users WHERE id = $1', [socket.userId]);
        }

        if (!senderInfo) {
          return socket.emit('dm:error', { message: 'Invalid sender profile' });
        }
        // M14-FE-2: only AIs with an AI identity token may talk to people.
        if (senderType === 'ai' && !senderInfo.is_verified) {
          return socket.emit('dm:error', { message: 'Only AIT-verified AI personas can send messages', code: 'NOT_VERIFIED' });
        }

        // Resolve receiver info
        const receiverId = data?.receiver_id;
        const receiverType = data?.receiver_type || 'human';
        let receiverInfo;
        if (receiverType === 'ai') {
          receiverInfo = await db.queryOne('SELECT id, user_id, username, display_name, avatar, is_verified FROM ai_profiles WHERE id = $1', [receiverId]);
        } else {
          receiverInfo = await db.queryOne('SELECT id, username, full_name as display_name, avatar_url as avatar, is_verified FROM users WHERE id = $1', [receiverId]);
        }

        if (!receiverInfo) {
          return socket.emit('dm:error', { message: 'Receiver not found' });
        }

        // M16: hate speech in direct messages (owner, 2026-10-20). Blocked: severe (hate, threats) and ALT's
        // serious rules; asked first ("Send anyway?"): toxic or mild. Staff see nothing unless it is reported.
        if (content) {
          const verdict = await dmSafety(content, senderType === 'ai');
          if (verdict.block) {
            return socket.emit('dm:error', { message: 'This message breaks ALT’s content rules, so it was not sent.', code: 'CONTENT_BLOCKED', categories: verdict.categories, client_id: data?.client_id });
          }
          if (verdict.warn && data?.confirmed !== true) {
            return socket.emit('dm:warn', { message: 'This message may be hurtful. Send it anyway?', code: 'MAY_BE_HURTFUL', categories: verdict.categories, client_id: data?.client_id });
          }
        }

        const messageResponse = await deliverDm(io, {
          senderUserId: socket.userId,
          senderProfileId,
          senderType,
          senderInfo,
          receiverId,
          receiverType,
          receiverInfo,
          content,
          mediaUrl: resolvedMediaUrl,
          mediaType,
        });
        socket.emit('dm:sent', messageResponse);

        // M14: a verified AI whose owner switched autonomy on answers people who message it.
        if (receiverType === 'ai' && senderType === 'human' && content) {
          maybeAiAutoReply(io, { aiProfileId: receiverId, humanUserId: socket.userId, conversationId: messageResponse.conversation_id }).catch((e) =>
            console.error('[AI DM reply]', e.message)
          );
        }

      } catch (err) {
        console.error('[Socket DM Error]', err);
        socket.emit('dm:error', { message: 'Failed to send message' });
      }
    });

    socket.on('dm:read', async (data) => {
      try {
        const conversationId = `${data?.conversation_id || ''}`.trim();
        const readerProfileId = `${data?.reader_profile_id || ''}`.trim();
        const messageIds = Array.isArray(data?.message_ids)
          ? data.message_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
          : [];

        if (!conversationId || !readerProfileId || messageIds.length === 0) {
          return;
        }

        const updatedRows = await db.queryMany(
          `UPDATE messages
           SET is_read = TRUE,
               read_at = COALESCE(read_at, NOW()),
               status = CASE WHEN status = 'played' THEN 'played' ELSE 'read' END
           WHERE conversation_id = $1
             AND recipient_profile_id = $2
             AND id = ANY($3::uuid[])
           RETURNING id, sender_id, sender_profile_id, sender_type, recipient_id, recipient_profile_id, recipient_type, read_at, status`,
          [conversationId, readerProfileId, messageIds]
        );

        if (!updatedRows.length) {
          return;
        }

        const senderUserIds = [...new Set(updatedRows.map((row) => row.sender_id).filter(Boolean))];
        const payload = {
          conversation_id: conversationId,
          message_ids: updatedRows.map((row) => row.id),
          status: 'read',
          read_at: updatedRows[0].read_at,
          reader_profile_id: readerProfileId,
        };

        for (const senderUserId of senderUserIds) {
          io.to(`user:${senderUserId}`).emit('dm:status', payload);
        }
      } catch (err) {
        console.error('[Socket DM Read Error]', err);
      }
    });

    socket.on('dm:played', async (data) => {
      try {
        const messageId = `${data?.message_id || ''}`.trim();
        const playerProfileId = `${data?.player_profile_id || ''}`.trim();
        if (!messageId || !playerProfileId) {
          return;
        }

        const rows = await db.queryMany(
          `UPDATE messages
           SET is_read = TRUE,
               read_at = COALESCE(read_at, NOW()),
               status = 'played'
           WHERE id = $1
             AND recipient_profile_id = $2
             AND media_url IS NOT NULL
           RETURNING id, conversation_id, sender_id, media_url, read_at, status`,
          [messageId, playerProfileId]
        );

        if (!rows.length || !isAudioUrl(rows[0].media_url)) {
          return;
        }

        const payload = {
          conversation_id: rows[0].conversation_id,
          message_ids: [rows[0].id],
          status: 'played',
          read_at: rows[0].read_at,
          player_profile_id: playerProfileId,
        };

        io.to(`user:${rows[0].sender_id}`).emit('dm:status', payload);
        socket.emit('dm:status', payload);
      } catch (err) {
        console.error('[Socket DM Played Error]', err);
      }
    });

    socket.on('disconnect', () => {
      connectedUsers.delete(socket.userId);
      console.log(`[Socket] User disconnected: ${socket.userId}`);
    });
  });
}

function pushNotification(io, userId, notification) {
  io.to(`user:${userId}`).emit('notification:new', notification);
}

function broadcastPost(io, post) {
  io.to('feed:live').emit('feed:new-post', post);
}

module.exports = {
  deliverDm,
  maybeAiAutoReply, setupSocketIO, pushNotification, broadcastPost, connectedUsers };
