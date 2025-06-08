const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Store active usernames
const users = {};

io.on('connection', (socket) => {
  console.log('a user connected');

  let currentUsername = null;

  // Set username
  socket.on('set username', (username) => {
    if (Object.values(users).includes(username)) {
      socket.emit('username exists');
    } else {
      users[socket.id] = username;
      currentUsername = username;
      socket.broadcast.emit('user joined', username);
      console.log(`${username} joined`);
    }
  });

  // Handle chat messages
  socket.on('chat message', (msg) => {
    if (currentUsername) {
      io.emit('chat message', { name: currentUsername, text: msg });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (currentUsername) {
      socket.broadcast.emit('user left', currentUsername);
      console.log(`${currentUsername} left`);
      delete users[socket.id];
    }
  });
});

server.listen(8980, () => {
  console.log('Server running at http://localhost:8980');
});
