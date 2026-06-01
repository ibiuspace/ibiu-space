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
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify({ "alex": "alex123", "sara": "sara456", "ibiu": "ibiu789" }, null, 2));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

let messages = [];
const MAX_MESSAGES = 500;

function loadUsers() { try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch(e) { return {}; } }

io.on('connection', function(socket) {
    let currentUser = null;

    socket.on('login', function(data) {
        let users = loadUsers();
        let username = (data.username || '').trim();
        let password = (data.password || '').trim();
        if (!username || !password) { socket.emit('login-error', 'Please fill all fields'); return; }
        if (!users[username]) { socket.emit('login-error', 'User not found'); return; }
        if (users[username] !== password) { socket.emit('login-error', 'Wrong password'); return; }
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
        } catch(e) { socket.emit('error', 'Upload failed'); }
    });

    socket.on('disconnect', function() { if (currentUser) io.emit('user-left', currentUser); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Ready on port ' + PORT); });