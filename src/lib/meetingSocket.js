const Meeting = require("../models/Meeting");

// In-memory room participant state: roomCode -> Map<socketId, participantData>
const activeRooms = new Map();

function setupMeetingSocket(io) {
  io.on("connection", (socket) => {
    // Track which meeting rooms this socket is in
    const joinedRooms = new Set();

    socket.on("meeting:join", async ({ roomCode, userId, name, role, isHost = false }) => {
      if (!roomCode) return;

      const cleanCode = String(roomCode).trim();
      socket.join(`meeting:${cleanCode}`);
      joinedRooms.add(cleanCode);

      if (!activeRooms.has(cleanCode)) {
        activeRooms.set(cleanCode, new Map());
      }

      const roomParticipants = activeRooms.get(cleanCode);

      const participantData = {
        socketId: socket.id,
        userId: String(userId || socket.data?.auth?.employeeId || socket.id),
        name: String(name || socket.data?.auth?.name || "Participant"),
        role: String(role || socket.data?.auth?.role || "employee"),
        isHost: Boolean(isHost),
        audioEnabled: true,
        videoEnabled: true,
        handRaised: false,
        isScreenSharing: false,
        joinedAt: new Date().toISOString(),
      };

      // Get existing participants before adding the new one
      const existing = Array.from(roomParticipants.values()).map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        name: p.name,
        role: p.role,
        isHost: p.isHost,
        audioEnabled: p.audioEnabled,
        videoEnabled: p.videoEnabled,
        handRaised: p.handRaised,
        isScreenSharing: p.isScreenSharing,
      }));

      // Add to room state
      roomParticipants.set(socket.id, participantData);

      // Send existing participants to the joining user
      socket.emit("meeting:existing-participants", {
        participants: existing,
        self: participantData,
      });

      // Broadcast newcomer to all other participants in the room
      socket.to(`meeting:${cleanCode}`).emit("meeting:user-joined", participantData);

      console.log(`[Meeting Socket] ${participantData.name} (${socket.id}) joined room ${cleanCode}. Total: ${roomParticipants.size}`);

      // Update DB meeting status to active if not already
      try {
        await Meeting.updateOne(
          { roomCode: cleanCode, status: { $in: ["scheduled", "active"] } },
          { $set: { status: "active", startedAt: new Date() } }
        );
      } catch (err) {
        console.error("[Meeting Socket] Error updating meeting status:", err.message);
      }
    });

    // WebRTC Signaling: Offer, Answer, ICE Candidate relay
    socket.on("meeting:signal", ({ toSocketId, signalData, type }) => {
      if (!toSocketId || !signalData) return;
      io.to(toSocketId).emit("meeting:signal", {
        fromSocketId: socket.id,
        signalData,
        type, // 'offer' | 'answer' | 'ice-candidate'
      });
    });

    // Media toggle (Mute/Unmute, Camera On/Off, Screen Sharing)
    socket.on("meeting:toggle-media", ({ roomCode, audioEnabled, videoEnabled, isScreenSharing }) => {
      if (!roomCode) return;
      const cleanCode = String(roomCode).trim();
      const roomParticipants = activeRooms.get(cleanCode);
      if (roomParticipants && roomParticipants.has(socket.id)) {
        const p = roomParticipants.get(socket.id);
        if (typeof audioEnabled === "boolean") p.audioEnabled = audioEnabled;
        if (typeof videoEnabled === "boolean") p.videoEnabled = videoEnabled;
        if (typeof isScreenSharing === "boolean") p.isScreenSharing = isScreenSharing;

        io.to(`meeting:${cleanCode}`).emit("meeting:media-state-changed", {
          socketId: socket.id,
          audioEnabled: p.audioEnabled,
          videoEnabled: p.videoEnabled,
          isScreenSharing: p.isScreenSharing,
        });
      }
    });

    // Raise / lower hand
    socket.on("meeting:raise-hand", ({ roomCode, handRaised }) => {
      if (!roomCode) return;
      const cleanCode = String(roomCode).trim();
      const roomParticipants = activeRooms.get(cleanCode);
      if (roomParticipants && roomParticipants.has(socket.id)) {
        const p = roomParticipants.get(socket.id);
        p.handRaised = Boolean(handRaised);

        io.to(`meeting:${cleanCode}`).emit("meeting:hand-state-changed", {
          socketId: socket.id,
          name: p.name,
          handRaised: p.handRaised,
        });
      }
    });

    // In-meeting text chat
    socket.on("meeting:chat-message", ({ roomCode, text }) => {
      if (!roomCode || !text || !String(text).trim()) return;
      const cleanCode = String(roomCode).trim();
      const roomParticipants = activeRooms.get(cleanCode);
      const sender = roomParticipants?.get(socket.id) || {
        name: socket.data?.auth?.name || "Participant",
        userId: socket.data?.auth?.employeeId || socket.id,
        role: socket.data?.auth?.role || "employee",
      };

      const messageObj = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        senderSocketId: socket.id,
        senderId: sender.userId,
        senderName: sender.name,
        senderRole: sender.role,
        text: String(text).trim(),
        timestamp: new Date().toISOString(),
      };

      io.to(`meeting:${cleanCode}`).emit("meeting:chat-broadcast", messageObj);
    });

    // Host actions (Mute user, Mute all, Kick user, End meeting)
    socket.on("meeting:host-action", async ({ roomCode, action, targetSocketId }) => {
      if (!roomCode || !action) return;
      const cleanCode = String(roomCode).trim();
      const roomParticipants = activeRooms.get(cleanCode);
      const actor = roomParticipants?.get(socket.id);

      // Verify host privileges
      if (!actor?.isHost && actor?.role !== "admin" && actor?.role !== "super-admin") {
        return socket.emit("meeting:error", { message: "Host permissions required" });
      }

      switch (action) {
        case "mute-user": {
          if (targetSocketId) {
            io.to(targetSocketId).emit("meeting:force-mute");
          }
          break;
        }
        case "mute-all": {
          socket.to(`meeting:${cleanCode}`).emit("meeting:force-mute");
          break;
        }
        case "kick-user": {
          if (targetSocketId) {
            io.to(targetSocketId).emit("meeting:kicked");
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
              targetSocket.leave(`meeting:${cleanCode}`);
              if (roomParticipants) roomParticipants.delete(targetSocketId);
              io.to(`meeting:${cleanCode}`).emit("meeting:user-left", { socketId: targetSocketId });
            }
          }
          break;
        }
        case "end-meeting": {
          io.to(`meeting:${cleanCode}`).emit("meeting:ended", {
            message: "The host has ended this meeting for all participants.",
          });
          activeRooms.delete(cleanCode);
          try {
            await Meeting.updateOne(
              { roomCode: cleanCode },
              { $set: { status: "ended", endedAt: new Date() } }
            );
          } catch (err) {
            console.error("[Meeting Socket] Error marking meeting ended:", err.message);
          }
          break;
        }
        default:
          break;
      }
    });

    // User explicitly leaves
    socket.on("meeting:leave", ({ roomCode }) => {
      handleUserLeave(cleanRoomCode(roomCode));
    });

    // Disconnect cleanup
    socket.on("disconnect", () => {
      for (const roomCode of joinedRooms) {
        handleUserLeave(roomCode);
      }
    });

    function cleanRoomCode(code) {
      return String(code || "").trim();
    }

    function handleUserLeave(cleanCode) {
      if (!cleanCode) return;
      socket.leave(`meeting:${cleanCode}`);
      joinedRooms.delete(cleanCode);

      const roomParticipants = activeRooms.get(cleanCode);
      if (roomParticipants && roomParticipants.has(socket.id)) {
        const p = roomParticipants.get(socket.id);
        roomParticipants.delete(socket.id);

        io.to(`meeting:${cleanCode}`).emit("meeting:user-left", {
          socketId: socket.id,
          userId: p.userId,
          name: p.name,
        });

        console.log(`[Meeting Socket] ${p.name} left room ${cleanCode}. Remaining: ${roomParticipants.size}`);

        if (roomParticipants.size === 0) {
          activeRooms.delete(cleanCode);
        }
      }
    }
  });
}

module.exports = { setupMeetingSocket };
