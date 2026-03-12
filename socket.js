const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export default function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    const userId = socket.data.session?.user?.id;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    // Personal room — used for live notifications (messages, matches)
    socket.join(`user:${userId}`);
    
    // Admin room — for new report notifications
    const userEmail = socket.data.session?.user?.email?.toLowerCase();
    if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
      socket.join("admin");
    }

    socket.on("join:match", (matchId) => {
      socket.join(`match:${matchId}`);
    });

    // Typing indicator — broadcast to others in the room
    socket.on("typing", ({ matchId, active }) => {
      if (!matchId) return;
      socket.to(`match:${matchId}`).emit("typing", {
        matchId,
        userId,
        active: Boolean(active),
      });
    });
  });
}
