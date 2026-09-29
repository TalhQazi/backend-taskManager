const Meeting = require("../models/Meeting");

// In-memory room participant state: roomCode -> Map<socketId, participantData>
const activeRooms = new Map();

function setupMeetingSocket(io) {
  io.on("connection", (socket) => {
    // Track which meeting rooms this socket is in
    const joinedRooms = new Set();

    socket.on("meeting:join", async ({ roomCode, userId, name, role, isHost = false }) => {
      if (!roomCode) return;

      const requestedCode = String(roomCode).trim();
      let meeting = null;

      // Only allow joining rooms that exist and are not ended
      try {
        meeting = await Meeting.findOne({
          roomCode: { $regex: new RegExp(`^${requestedCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        });
        if (!meeting) {
          socket.emit("meeting:error", { message: "Meeting not found for this room code." });
          return;
        }
        if (meeting.status === "ended" || meeting.status === "cancelled") {
          // Allow the host to rejoin the same room (e.g. after Back); others stay blocked
          const joinerUserIdPreview = String(
            userId || socket.data?.auth?.employeeId || socket.data?.auth?.sub || ""
          );
          const joinerEmailPreview = String(
            socket.data?.auth?.email || socket.data?.auth?.username || ""
          ).toLowerCase();
          const hostRejoining =
            String(meeting.hostId) === joinerUserIdPreview ||
            (meeting.hostEmail &&
              joinerEmailPreview &&
              String(meeting.hostEmail).toLowerCase() === joinerEmailPreview);
          if (!hostRejoining) {
            socket.emit("meeting:error", { message: "This meeting has ended." });
            return;
          }
          meeting.status = "active";
          meeting.endedAt = null;
          await meeting.save();
        }
      } catch (err) {
        console.error("[Meeting Socket] Join validation failed:", err.message);
        socket.emit("meeting:error", { message: "Could not validate meeting room." });
        return;
      }

      // Always use the canonical DB room code so case/format mismatches don't split rooms
      const cleanCode = String(meeting.roomCode);
      const joinerUserId = String(userId || socket.data?.auth?.employeeId || socket.data?.auth?.sub || socket.id);
      const joinerEmail = String(
        socket.data?.auth?.email || socket.data?.auth?.username || ""
      ).toLowerCase();

      // Host privileges come from DB — never trust client isHost / admin role alone
      const actualIsHost =
        String(meeting.hostId) === joinerUserId ||
        (meeting.hostEmail &&
          joinerEmail &&
          String(meeting.hostEmail).toLowerCase() === joinerEmail);

      // Cancel any pending auto-end (host hit Back and is rejoining)
      if (global.__meetingEmptyTimers?.has(cleanCode)) {
        clearTimeout(global.__meetingEmptyTimers.get(cleanCode));
        global.__meetingEmptyTimers.delete(cleanCode);
      }

      socket.join(`meeting:${cleanCode}`);
      joinedRooms.add(cleanCode);

      if (!activeRooms.has(cleanCode)) {
        activeRooms.set(cleanCode, new Map());
      }

      const roomParticipants = activeRooms.get(cleanCode);

      const participantData = {
        socketId: socket.id,
        userId: joinerUserId,
        name: String(name || socket.data?.auth?.name || "Participant"),
        role: String(role || socket.data?.auth?.role || "employee"),
        isHost: Boolean(actualIsHost),
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

      console.log(
        `[Meeting Socket] ${participantData.name} (${socket.id}) joined room ${cleanCode} (host=${actualIsHost}). Total: ${roomParticipants.size}`
      );

      // Update DB meeting status to active if not already + track joiner
      try {
        const updates = {};
        if (["scheduled", "active"].includes(meeting.status)) {
          updates.status = "active";
          if (!meeting.startedAt) updates.startedAt = new Date();
        }

        const joiner = {
          userId: participantData.userId,
          name: participantData.name,
          email: joinerEmail,
          role: participantData.role,
          joinedAt: new Date(),
          leftAt: null,
        };

        const existingIdx = (meeting.joinedParticipants || []).findIndex(
          (j) =>
            (j.userId && j.userId === joiner.userId) ||
            (j.name && j.name.toLowerCase() === String(joiner.name).toLowerCase())
        );

        if (existingIdx >= 0) {
          meeting.joinedParticipants[existingIdx].leftAt = null;
          meeting.joinedParticipants[existingIdx].joinedAt = new Date();
          meeting.joinedParticipants[existingIdx].name = joiner.name;
          meeting.joinedParticipants[existingIdx].role = joiner.role;
        } else {
          if (!Array.isArray(meeting.joinedParticipants)) meeting.joinedParticipants = [];
          meeting.joinedParticipants.push(joiner);
        }

        Object.assign(meeting, updates);
        await meeting.save();
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
      // Resolve canonical room key from in-memory maps (case-insensitive)
      let resolvedCode = cleanCode;
      if (!activeRooms.has(resolvedCode)) {
        for (const key of activeRooms.keys()) {
          if (String(key).toLowerCase() === cleanCode.toLowerCase()) {
            resolvedCode = key;
            break;
          }
        }
      }
      const roomParticipants = activeRooms.get(resolvedCode);
      const actor = roomParticipants?.get(socket.id);

      // Only the real meeting host (not every admin) can control the room
      if (!actor?.isHost) {
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
          socket.to(`meeting:${resolvedCode}`).emit("meeting:force-mute");
          break;
        }
        case "kick-user": {
          if (targetSocketId) {
            io.to(targetSocketId).emit("meeting:kicked");
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
              targetSocket.leave(`meeting:${resolvedCode}`);
              if (roomParticipants) roomParticipants.delete(targetSocketId);
              io.to(`meeting:${resolvedCode}`).emit("meeting:user-left", { socketId: targetSocketId });
            }
          }
          break;
        }
        case "end-meeting": {
          io.to(`meeting:${resolvedCode}`).emit("meeting:ended", {
            message: "The host has ended this meeting for all participants.",
          });
          activeRooms.delete(resolvedCode);
          try {
            await Meeting.updateOne(
              {
                roomCode: {
                  $regex: new RegExp(`^${resolvedCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
                },
              },
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

    // Broadcast local recording indicator to the room
    socket.on("meeting:recording-state", ({ roomCode, recording }) => {
      const cleanCode = cleanRoomCode(roomCode);
      if (!cleanCode) return;
      const actor = activeRooms.get(cleanCode)?.get(socket.id);
      socket.to(`meeting:${cleanCode}`).emit("meeting:recording-state", {
        recording: Boolean(recording),
        bySocketId: socket.id,
        byName: actor?.name || "Someone",
      });
    });

    // User explicitly leaves
    socket.on("meeting:leave", ({ roomCode }) => {
      handleUserLeave(roomCode);
    });

    // Disconnect cleanup
    socket.on("disconnect", () => {
      for (const roomCode of [...joinedRooms]) {
        handleUserLeave(roomCode);
      }
    });

    function cleanRoomCode(code) {
      return String(code || "").trim();
    }

    /** Resolve to the canonical in-memory / DB room key (case-insensitive). */
    function resolveActiveRoomKey(code) {
      const clean = cleanRoomCode(code);
      if (!clean) return "";
      if (activeRooms.has(clean)) return clean;
      const lower = clean.toLowerCase();
      for (const key of activeRooms.keys()) {
        if (String(key).toLowerCase() === lower) return key;
      }
      return clean;
    }

    function cancelPendingEnd(roomKey) {
      if (global.__meetingEmptyTimers?.has(roomKey)) {
        clearTimeout(global.__meetingEmptyTimers.get(roomKey));
        global.__meetingEmptyTimers.delete(roomKey);
      }
    }

    function scheduleEndIfStillEmpty(roomKey, meetingId) {
      if (!global.__meetingEmptyTimers) global.__meetingEmptyTimers = new Map();
      cancelPendingEnd(roomKey);
      const timer = setTimeout(async () => {
        global.__meetingEmptyTimers.delete(roomKey);
        const still = activeRooms.get(roomKey);
        if (still && still.size > 0) return;
        activeRooms.delete(roomKey);
        if (!meetingId) return;
        try {
          await Meeting.updateOne(
            { _id: meetingId, status: { $ne: "ended" } },
            { $set: { status: "ended", endedAt: new Date() } }
          );
          console.log(`[Meeting Socket] Auto-ended empty room ${roomKey}`);
        } catch (err) {
          console.error("[Meeting Socket] Auto-end failed:", err.message);
        }
      }, 60 * 1000); // 60s grace — host can rejoin after Back
      global.__meetingEmptyTimers.set(roomKey, timer);
    }

    function handleUserLeave(rawCode) {
      const cleanCode = resolveActiveRoomKey(rawCode);
      if (!cleanCode) return;
      socket.leave(`meeting:${cleanCode}`);
      joinedRooms.delete(cleanCode);

      const roomParticipants = activeRooms.get(cleanCode);
      if (!roomParticipants || !roomParticipants.has(socket.id)) {
        // Also try other case variants for this socket
        return;
      }

      const p = roomParticipants.get(socket.id);
      roomParticipants.delete(socket.id);

      io.to(`meeting:${cleanCode}`).emit("meeting:user-left", {
        socketId: socket.id,
        userId: p.userId,
        name: p.name,
      });

      console.log(`[Meeting Socket] ${p.name} left room ${cleanCode}. Remaining: ${roomParticipants.size}`);

      Meeting.findOne({
        roomCode: { $regex: new RegExp(`^${cleanCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      })
        .then(async (meeting) => {
          if (!meeting) return;

          const idx = (meeting.joinedParticipants || []).findIndex(
            (j) =>
              (j.userId && j.userId === p.userId && !j.leftAt) ||
              (j.name && j.name.toLowerCase() === String(p.name).toLowerCase() && !j.leftAt)
          );
          if (idx >= 0) {
            meeting.joinedParticipants[idx].leftAt = new Date();
          }

          // IMPORTANT: leaving/back must NOT instantly end the meeting.
          // Employee may still be in the room; host must be able to rejoin the same code.
          if (roomParticipants.size === 0) {
            // Keep status "active" during grace; only then mark ended
            await meeting.save();
            scheduleEndIfStillEmpty(cleanCode, meeting._id);
          } else {
            cancelPendingEnd(cleanCode);
            // Ensure meeting stays active while anyone remains
            if (meeting.status !== "active" && meeting.status !== "ended") {
              meeting.status = "active";
            }
            await meeting.save();
          }
        })
        .catch((err) => {
          console.error("[Meeting Socket] Error updating leave:", err.message);
          if (roomParticipants.size === 0) {
            // still schedule cleanup of memory map later
            scheduleEndIfStillEmpty(cleanCode, null);
          }
        });
    }
  });
}

module.exports = { setupMeetingSocket };
