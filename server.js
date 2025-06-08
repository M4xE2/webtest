const adminPassword = '244466666'; // change this to something secret

function basicAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = decoded.split(':');

  if (user === 'admin' && pass === adminPassword) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).send('Access denied');
}

const express = require('express');
const uploadedFiles = {}; // filename -> timeout ID
let connectedUsers = 0;
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Change port here
const PORT = 8980;

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create uploads folder if missing
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});


// File upload config (10MB, only safe types)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
    cb(null, safeName);
  }
});
const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/png',
    'image/jpeg',
    'application/pdf',
    'text/plain',
    'audio/mpeg',    // .mp3
    'video/mp4',     // .mp4
    'application/zip'
  ];
  cb(null, allowed.includes(file.mimetype));
};
const upload = multer({ storage, limits: { fileSize: 50000 * 1024 * 1024 }, fileFilter });

let isChatLocked = false;
let isUploadsLocked = false;

app.post('/admin/chat-lock', basicAuth, (req, res) => {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    const { locked } = JSON.parse(body);
    isChatLocked = !!locked;
    io.emit('chat-lock', isChatLocked);
    res.sendStatus(200);
  });
});

app.post('/admin/uploads-lock', basicAuth, (req, res) => {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    const { locked } = JSON.parse(body);
    isUploadsLocked = !!locked;
    res.sendStatus(200);
  });
});

app.delete('/admin/delete-file/:filename', basicAuth, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);
  fs.unlink(filePath, (err) => {
    if (err) return res.status(404).send('Not found');
    if (uploadedFiles[filename]) {
      clearTimeout(uploadedFiles[filename]);
      delete uploadedFiles[filename];
    }
    res.sendStatus(200);
  });
});


// Upload endpoint
app.post('/upload', (req, res, next) => {
  if (isUploadsLocked) {
    return res.status(403).send('Uploads are locked by admin.');
  }
  next();
}, upload.single('file'), (req, res) => {
  if (req.file) {
    const filePath = path.join(uploadDir, req.file.filename);

    const timeout = setTimeout(() => {
      fs.unlink(filePath, (err) => {
        if (!err) {
          console.log(`🗑️ Deleted expired file: ${req.file.filename}`);
        }
        delete uploadedFiles[req.file.filename];
      });
    }, 30 * 60 * 1000); // 30 min

    uploadedFiles[req.file.filename] = timeout;
  }

  res.redirect('/');
});


// List uploaded files
app.get('/files', (req, res) => {
  fs.readdir('uploads', (err, files) => {
    if (err) return res.status(500).send('Failed to read uploads');
    res.json(files);
  });
});

// ----- Chat Stuff -----

const users = {};

io.on('connection', (socket) => {
  connectedUsers++;
  console.log(`🔌 User connected (${connectedUsers} total)`);

  let currentUsername = null;

  socket.on('set username', (username) => {
    if (Object.values(users).includes(username)) {
      socket.emit('username exists');
    } else {
      users[socket.id] = username;
      currentUsername = username;
      socket.broadcast.emit('user joined', username);
    }
  });

  socket.on('chat message', (msg) => {
    if (currentUsername && !isChatLocked) {
      io.emit('chat message', { name: currentUsername, text: msg });
    }
  });


  socket.on('disconnect', () => {
    connectedUsers--;
    console.log(`❌ User disconnected (${connectedUsers} left)`);

    if (currentUsername) {
      socket.broadcast.emit('user left', currentUsername);
      delete users[socket.id];
    }

    // 🧨 Delete all files if no users left
    if (connectedUsers === 0) {
      console.log('🧨 No users left, deleting all uploads...');
      fs.readdir(uploadDir, (err, files) => {
        if (!err) {
          files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.unlink(filePath, () => {
              console.log(`🗑️ Deleted file: ${file}`);
            });
          });
        }

        // Clear all file timers
        for (const file in uploadedFiles) {
          clearTimeout(uploadedFiles[file]);
          delete uploadedFiles[file];
        }
      });
    }
  });
});


server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

