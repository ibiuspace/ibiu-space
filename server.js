const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { maxHttpBufferSize: 1e8 });

const uploadDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(__dirname, 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir);

const usersFile = path.join(__dirname, 'users.json');
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify({ "ibiu": "admin123", "alex": "alex123", "sara": "sara456" }, null, 2));

const profilesFile = path.join(__dirname, 'profiles.json');
if (!fs.existsSync(profilesFile)) fs.writeFileSync(profilesFile, '{}');

const groupsFile = path.join(__dirname, 'groups.json');
if (!fs.existsSync(groupsFile)) fs.writeFileSync(groupsFile, JSON.stringify({ "ibiu-news": { admin: "ibiu", members: [], messages: [] } }, null, 2));

const pvMessagesFile = path.join(__dirname, 'pv_messages.json');
if (!fs.existsSync(pvMessagesFile)) fs.writeFileSync(pvMessagesFile, '{}');

const reactionsFile = path.join(__dirname, 'reactions.json');
if (!fs.existsSync(reactionsFile)) fs.writeFileSync(reactionsFile, '{}');

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use('/avatars', express.static(avatarsDir));

app.get('/chat', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'chat', 'index.html'));
});

app.get('/api/users', function(req, res) {
    let users = loadJSON(usersFile);
    res.json(Object.keys(users));
});

function loadJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { return {}; } }
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let onlineUsers = {};

io.on('connection', function(socket) {
    let currentUser = null;

    socket.on('register', function(data) {
        let users = loadJSON(usersFile);
        let username = (data.username || '').trim().toLowerCase();
        let password = (data.password || '').trim();
        if (!username || !password) { socket.emit('error-msg', 'All fields are required.'); return; }
        if (username.length < 3) { socket.emit('error-msg', 'Username must be at least 3 characters.'); return; }
        if (password.length < 4) { socket.emit('error-msg', 'Password must be at least 4 characters.'); return; }
        if (users[username]) { socket.emit('error-msg', 'Username already taken.'); return; }
        users[username] = password;
        saveJSON(usersFile, users);

        let groups = loadJSON(groupsFile);
        if (groups['ibiu-news']) {
            groups['ibiu-news'].members.push(username);
            saveJSON(groupsFile, groups);
        }

        let profiles = loadJSON(profilesFile);
        profiles[username] = { avatar: '', bio: '' };
        saveJSON(profilesFile, profiles);

        socket.emit('register-ok', 'Account created! You can now sign in.');
    });

    socket.on('login', function(data) {
        let users = loadJSON(usersFile);
        let username = (data.username || '').trim().toLowerCase();
        let password = (data.password || '').trim();
        if (!username || !password) { socket.emit('error-msg', 'All fields are required.'); return; }
        if (!users[username]) { socket.emit('error-msg', 'Account not found.'); return; }
        if (users[username] !== password) { socket.emit('error-msg', 'Incorrect password.'); return; }
        currentUser = username;
        onlineUsers[username] = true;
        io.emit('user-online', username);
        let groups = loadJSON(groupsFile);
        socket.emit('login-ok', { username: username, groups: groups });
    });

    socket.on('search-user', function(query) {
        let users = loadJSON(usersFile);
        let results = Object.keys(users).filter(function(u) { return u.includes(query.toLowerCase()) && u !== 'ibiu'; });
        socket.emit('search-results', results);
    });

    socket.on('get-pv', function(data) {
        let withUser = data.with;
        let pvKey = [currentUser, withUser].sort().join('_');
        let pvMessages = loadJSON(pvMessagesFile);
        if (!pvMessages[pvKey]) pvMessages[pvKey] = [];
        let profiles = loadJSON(profilesFile);
        socket.emit('pv-data', {
            messages: pvMessages[pvKey],
            withUser: withUser,
            avatar: profiles[withUser] ? profiles[withUser].avatar : ''
        });
    });

    socket.on('pv-msg', function(data) {
        if (!currentUser) return;
        let withUser = data.to;
        let text = (data.text || '').trim().slice(0, 5000);
        let pvKey = [currentUser, withUser].sort().join('_');
        let pvMessages = loadJSON(pvMessagesFile);
        if (!pvMessages[pvKey]) pvMessages[pvKey] = [];
        let msgObj = {
            id: crypto.randomUUID(),
            from: currentUser,
            text: text,
            type: 'text',
            time: Date.now(),
            seen: false
        };
        pvMessages[pvKey].push(msgObj);
        saveJSON(pvMessagesFile, pvMessages);
        io.emit('pv-msg', { pvKey: pvKey, msg: msgObj });
    });

    socket.on('pv-file', function(data) {
        if (!currentUser) return;
        let withUser = data.to;
        let pvKey = [currentUser, withUser].sort().join('_');
        const filename = Date.now() + '_' + data.name;
        const filePath = path.join(uploadDir, filename);
        try {
            fs.writeFileSync(filePath, Buffer.from(new Uint8Array(data.data)));
            let pvMessages = loadJSON(pvMessagesFile);
            if (!pvMessages[pvKey]) pvMessages[pvKey] = [];
            let msgObj = {
                id: crypto.randomUUID(),
                from: currentUser,
                type: 'file',
                fileName: data.name,
                fileUrl: '/uploads/' + filename,
                mime: data.mime,
                time: Date.now(),
                seen: false
            };
            pvMessages[pvKey].push(msgObj);
            saveJSON(pvMessagesFile, pvMessages);
            io.emit('pv-msg', { pvKey: pvKey, msg: msgObj });
        } catch(e) { socket.emit('error-msg', 'Upload failed.'); }
    });

    socket.on('mark-seen', function(data) {
        let pvKey = data.pvKey;
        let pvMessages = loadJSON(pvMessagesFile);
        if (pvMessages[pvKey]) {
            pvMessages[pvKey].forEach(function(m) { if (m.from !== currentUser) m.seen = true; });
            saveJSON(pvMessagesFile, pvMessages);
            io.emit('messages-updated', { pvKey: pvKey, messages: pvMessages[pvKey] });
        }
    });

    socket.on('delete-msg', function(data) {
        let pvKey = data.pvKey;
        let msgId = data.msgId;
        let pvMessages = loadJSON(pvMessagesFile);
        if (pvMessages[pvKey]) {
            pvMessages[pvKey] = pvMessages[pvKey].filter(function(m) { return m.id !== msgId; });
            saveJSON(pvMessagesFile, pvMessages);
            io.emit('message-deleted', { pvKey: pvKey, msgId: msgId });
        }
    });

    socket.on('react', function(data) {
        let pvKey = data.pvKey;
        let msgId = data.msgId;
        let emoji = data.emoji;
        let reactions = loadJSON(reactionsFile);
        if (!reactions[pvKey]) reactions[pvKey] = {};
        if (!reactions[pvKey][msgId]) reactions[pvKey][msgId] = {};
        if (!reactions[pvKey][msgId][emoji]) reactions[pvKey][msgId][emoji] = [];
        let idx = reactions[pvKey][msgId][emoji].indexOf(currentUser);
        if (idx > -1) reactions[pvKey][msgId][emoji].splice(idx, 1);
        else reactions[pvKey][msgId][emoji].push(currentUser);
        if (reactions[pvKey][msgId][emoji].length === 0) delete reactions[pvKey][msgId][emoji];
        saveJSON(reactionsFile, reactions);
        io.emit('reaction-update', { pvKey: pvKey, msgId: msgId, reactions: reactions[pvKey][msgId] });
    });

    socket.on('group-msg', function(data) {
        if (currentUser !== 'ibiu') { socket.emit('error-msg', 'Only admin can post.'); return; }
        let text = (data.text || '').trim().slice(0, 5000);
        let groups = loadJSON(groupsFile);
        let msgObj = {
            id: crypto.randomUUID(),
            from: 'ibiu',
            text: text,
            type: 'text',
            time: Date.now(),
            views: []
        };
        groups['ibiu-news'].messages.push(msgObj);
        saveJSON(groupsFile, groups);
        io.emit('group-msg', { group: 'ibiu-news', msg: msgObj });
    });

    socket.on('view-group-msg', function(data) {
        if (!currentUser) return;
        let groups = loadJSON(groupsFile);
        let msgs = groups['ibiu-news'].messages;
        for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].id === data.msgId) {
                if (msgs[i].views.indexOf(currentUser) === -1) {
                    msgs[i].views.push(currentUser);
                }
            }
        }
        saveJSON(groupsFile, groups);
        io.emit('group-updated', groups['ibiu-news']);
    });

    socket.on('typing', function(data) {
        socket.broadcast.emit('user-typing', { user: currentUser, to: data.to });
    });

    socket.on('update-avatar', function(data) {
        if (!currentUser) return;
        const filename = 'avatar_' + currentUser + '_' + Date.now() + '.jpg';
        const filePath = path.join(avatarsDir, filename);
        try {
            fs.writeFileSync(filePath, Buffer.from(new Uint8Array(data.data)));
            let profiles = loadJSON(profilesFile);
            if (!profiles[currentUser]) profiles[currentUser] = { avatar: '', bio: '' };
            profiles[currentUser].avatar = '/avatars/' + filename;
            saveJSON(profilesFile, profiles);
            socket.emit('avatar-updated', '/avatars/' + filename);
            io.emit('user-avatar-changed', { user: currentUser, avatar: '/avatars/' + filename });
        } catch(e) { socket.emit('error-msg', 'Avatar upload failed.'); }
    });

    socket.on('get-profile', function(data) {
        let profiles = loadJSON(profilesFile);
        let avatar = profiles[currentUser] ? profiles[currentUser].avatar : '';
        socket.emit('profile-data', { username: currentUser, avatar: avatar });
    });

    socket.on('disconnect', function() {
        if (currentUser) {
            delete onlineUsers[currentUser];
            io.emit('user-offline', currentUser);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Ready'); });