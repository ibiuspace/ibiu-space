const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { maxHttpBufferSize: 1e8 });

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const usersFile = path.join(__dirname, 'users.json');
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '{}');

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

let messages = [];
const MAX_MESSAGES = 500;

function loadUsers() { try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch(e) { return {}; } }
function saveUsers(u) { fs.writeFileSync(usersFile, JSON.stringify(u, null, 2)); }

io.on('connection', function(socket) {
    let currentUser = null;

    socket.on('register', function(data) {
        let users = loadUsers();
        let username = (data.username || '').trim().toLowerCase();
        let password = (data.password || '').trim();
        if (!username || !password) { socket.emit('error-msg', 'All fields are required.'); return; }
        if (username.length < 3) { socket.emit('error-msg', 'Username must be at least 3 characters.'); return; }
        if (password.length < 4) { socket.emit('error-msg', 'Password must be at least 4 characters.'); return; }
        if (users[username]) { socket.emit('error-msg', 'This username is already taken.'); return; }
        users[username] = password;
        saveUsers(users);
        socket.emit('register-ok', 'Account created successfully! You can now sign in.');
    });

    socket.on('login', function(data) {
        let users = loadUsers();
        let username = (data.username || '').trim().toLowerCase();
        let password = (data.password || '').trim();
        if (!username || !password) { socket.emit('error-msg', 'All fields are required.'); return; }
        if (!users[username]) { socket.emit('error-msg', 'Account not found. Please sign up first.'); return; }
        if (users[username] !== password) { socket.emit('error-msg', 'Incorrect password.'); return; }
        currentUser = username;
        socket.emit('login-ok', { username: username, messages: messages });
        io.emit('user-joined', username);
    });

    socket.on('msg', function(text) {
        if (!currentUser || !text) return;
        text = text.trim().slice(0, 5000);
        let msgObj = { id: Date.now(), user: currentUser, text: text, type: 'text', time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) };
        messages.push(msgObj);
        if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
        io.emit('msg', msgObj);
    });

    socket.on('file', function(f) {
        if (!currentUser || !f) return;
        const name = Date.now() + '_' + f.name;
        const filePath = path.join(uploadDir, name);
        try {
            fs.writeFileSync(filePath, Buffer.from(new Uint8Array(f.data)));
            let msgObj = { id: Date.now(), user: currentUser, type: 'file', fileName: f.name, fileUrl: '/uploads/' + name, mime: f.mime, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) };
            messages.push(msgObj);
            if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
            io.emit('file', msgObj);
        } catch(e) { socket.emit('error-msg', 'Upload failed.'); }
    });

    socket.on('disconnect', function() { if (currentUser) io.emit('user-left', currentUser); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Ready'); });