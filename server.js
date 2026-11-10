const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const rooms = new Map();
const code = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function publicRoom(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    settings: room.settings,
    started: room.started,
    round: room.round,
    currentPlayer: room.order[room.turnIndex] || null,
    submissions: room.submissions.length
  };
}
function sendRoom(room) {
  io.to(room.code).emit("room-update", publicRoom(room));
}
function nextTurn(room) {
  if (room.submissions.length >= room.order.length * room.settings.rounds) {
    room.started = false;
    room.finished = true;
    io.to(room.code).emit("game-finished", { works: room.submissions, players: room.players.map(p=>p.name) });
    sendRoom(room);
    return;
  }
  room.turnIndex++;
  if (room.turnIndex >= room.order.length) {
    room.turnIndex = 0;
    room.round++;
  }
  io.to(room.code).emit("turn-start", {
    playerId: room.order[room.turnIndex],
    round: room.round,
    totalRounds: room.settings.rounds,
    duration: room.settings.seconds,
    previous: room.submissions[room.submissions.length - 1]?.abstract || null
  });
  sendRoom(room);
}
io.on("connection", socket => {
  socket.on("create-room", ({ name }) => {
    let roomCode;
    do { roomCode = code(); } while (rooms.has(roomCode));
    const room = {
      code: roomCode, host: socket.id,
      players: [{ id: socket.id, name: String(name || "玩家1").slice(0,16) }],
      settings: { seconds: 60, rounds: 1 }, started: false, finished: false,
      order: [], turnIndex: 0, round: 1, submissions: []
    };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit("room-created", publicRoom(room));
    sendRoom(room);
  });
  socket.on("join-room", ({ code: raw, name }) => {
    const room = rooms.get(String(raw || "").toUpperCase());
    if (!room) return socket.emit("error-message", "找不到這個房間，請確認房間代碼。");
    if (room.started || room.finished) return socket.emit("error-message", "遊戲已經開始或結束，現在不能加入。");
    if (room.players.length >= 8) return socket.emit("error-message", "房間最多 8 人。");
    room.players.push({ id: socket.id, name: String(name || "玩家").slice(0,16) });
    socket.join(room.code);
    socket.emit("joined-room", publicRoom(room));
    sendRoom(room);
  });
  socket.on("update-settings", settings => {
    const room = [...rooms.values()].find(r => r.host === socket.id);
    if (!room || room.started) return;
    room.settings.seconds = Math.max(20, Math.min(180, Number(settings.seconds) || 60));
    room.settings.rounds = Math.max(1, Math.min(4, Number(settings.rounds) || 1));
    sendRoom(room);
  });
  socket.on("start-game", () => {
    const room = [...rooms.values()].find(r => r.host === socket.id);
    if (!room || room.started || room.players.length < 2) return;
    room.started = true;
    room.finished = false;
    room.order = room.players.map(p => p.id);
    room.turnIndex = 0;
    room.round = 1;
    room.submissions = [];
    io.to(room.code).emit("game-started");
    io.to(room.code).emit("turn-start", {
      playerId: room.order[0], round: 1, totalRounds: room.settings.rounds,
      duration: room.settings.seconds, previous: null
    });
    sendRoom(room);
  });
  socket.on("submit-drawing", ({ image, abstract }) => {
    const room = [...rooms.values()].find(r => r.started && r.order[r.turnIndex] === socket.id);
    if (!room) return;
    room.submissions.push({
      playerName: room.players.find(p=>p.id===socket.id)?.name || "玩家",
      image, abstract, round: room.round
    });
    io.to(room.code).emit("work-added", { count: room.submissions.length });
    nextTurn(room);
  });
  socket.on("disconnect", () => {
    for (const [key, room] of rooms) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (!room.players.length) rooms.delete(key);
      else {
        if (room.host === socket.id) room.host = room.players[0].id;
        if (room.started && room.order[room.turnIndex] === socket.id) nextTurn(room);
        sendRoom(room);
      }
    }
  });
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
