const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 12e6 });
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
    submissions: room.submissions.length
  };
}
function sendRoom(room) { io.to(room.code).emit("room-update", publicRoom(room)); }

function finishGame(room) {
  room.started = false;
  room.finished = true;
  const works = room.submissions.sort((a,b) => a.round - b.round ||
    room.order.indexOf(a.playerId) - room.order.indexOf(b.playerId));
  io.to(room.code).emit("game-finished", {
    works,
    players: room.players.map(p => p.name),
    rounds: room.settings.rounds
  });
  sendRoom(room);
}

function startRound(room) {
  if (room.round > room.settings.rounds + 1) return finishGame(room);
  room.roundSubmissions = new Map();
  room.order.forEach((playerId, index) => {
    const previousPlayerId = room.order[(index - 1 + room.order.length) % room.order.length];
    const previous = room.round === 1 ? null :
      (room.lastRoundSubmissions.get(previousPlayerId)?.abstract || null);
    io.to(playerId).emit("turn-start", {
      round: room.round,
      totalRounds: room.settings.rounds + 1,
      duration: room.settings.seconds,
      previous
    });
  });
  io.to(room.code).emit("round-started", { round: room.round, totalRounds: room.settings.rounds });
  sendRoom(room);
}

function advanceWhenReady(room) {
  if (room.roundSubmissions.size !== room.order.length) return;
  const completed = room.order.map(id => room.roundSubmissions.get(id)).filter(Boolean);
  completed.forEach(work => room.submissions.push(work));
  room.lastRoundSubmissions = new Map(completed.map(work => [work.playerId, work]));
  if (room.round >= room.settings.rounds + 1) finishGame(room);
  else {
    room.round += 1;
    startRound(room);
  }
}

io.on("connection", socket => {
  socket.on("create-room", ({ name }) => {
    let roomCode;
    do { roomCode = code(); } while (rooms.has(roomCode));
    const room = {
      code: roomCode, host: socket.id,
      players: [{ id: socket.id, name: String(name || "玩家1").slice(0,16) }],
      settings: { seconds: 60, rounds: 1 }, started: false, finished: false,
      order: [], round: 1, submissions: [],
      roundSubmissions: new Map(), lastRoundSubmissions: new Map()
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
    room.round = 1;
    room.submissions = [];
    room.roundSubmissions = new Map();
    room.lastRoundSubmissions = new Map();
    io.to(room.code).emit("game-started");
    startRound(room);
  });

  socket.on("submit-drawing", ({ image, abstract, round }) => {
    const room = [...rooms.values()].find(r => r.started && r.order.includes(socket.id));
    if (!room || Number(round) !== room.round || room.roundSubmissions.has(socket.id)) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    room.roundSubmissions.set(socket.id, {
      playerId: socket.id,
      playerName: player.name,
      image: String(image || ""),
      abstract: String(abstract || image || ""),
      round: room.round
    });
    socket.emit("drawing-received");
    io.to(room.code).emit("work-added", { count: room.roundSubmissions.size, total: room.order.length });
    advanceWhenReady(room);
  });

  socket.on("disconnect", () => {
    for (const [key, room] of rooms) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (!room.players.length) { rooms.delete(key); continue; }
      if (room.host === socket.id) room.host = room.players[0].id;
      if (room.started) {
        room.order = room.order.filter(id => id !== socket.id);
        if (room.roundSubmissions.has(socket.id)) room.roundSubmissions.delete(socket.id);
        advanceWhenReady(room);
      }
      sendRoom(room);
    }
  });
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
