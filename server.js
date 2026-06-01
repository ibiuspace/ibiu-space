const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    maxHttpBufferSize: 1e8
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const usersFile = path.join(__dirname, 'users.json');
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '{}');

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

const PASSWORD = '1234';

let messages = [];
const MAX_MESSAGES = 500;

function loadUsers() {
    try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); }
    catch(e) { return {}; }
}

function saveUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

io.on('connection', function(socket) {
    let currentUser = null;

    socket.on('join', function(data) {
        if (data.pass !== PASSWORD) {
            socket.emit('error', 'رمز اشتباه');
            socket.disconnect();
            return;
        }
        let users = loadUsers();
        let name = (data.name && data.name.trim()) ? data.name.trim() : 'کاربر';
        if (name.length > 20) name = name.slice(0, 20);
        let savedName = users[socket.id];
        if (savedName) name = savedName;
        else {
            users[socket.id] = name;
            saveUsers(users);
        }
        currentUser = name;
        socket.emit('ok', { name: name, messages: messages });
        io.emit('user-joined', name);
    });

    socket.on('set-name', function(name) {
        if (!name || !currentUser) return;
        name = name.trim();
        if (name.length > 20) name = name.slice(0, 20);
        let users = loadUsers();
        users[socket.id] = name;
        saveUsers(users);
        let oldName = currentUser;
        currentUser = name;
        io.emit('name-changed', { old: oldName, new: name });
    });

    socket.on('msg', function(text) {
        if (!currentUser || !text) return;
        text = text.trim();
        if (text.length > 5000) text = text.slice(0, 5000);
        let msgObj = {
            id: Date.now(),
            user: currentUser,
            text: text,
            type: 'text',
            time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        };
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
            let msgObj = {
                id: Date.now(),
                user: currentUser,
                type: 'file',
                fileName: f.name,
                fileUrl: '/uploads/' + name,
                mime: f.mime,
                time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
            };
            messages.push(msgObj);
            if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
            io.emit('file', msgObj);
        } catch(e) {
            socket.emit('error', 'آپلود نشد');
        }
    });

    socket.on('disconnect', function() {
        if (currentUser) {
            io.emit('user-left', currentUser);
        }
    });
});

server.listen(3000, function() {
    console.log('Ready');
});