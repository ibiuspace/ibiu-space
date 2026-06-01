const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { maxHttpBufferSize: 5e8 });

const uploadDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(__dirname, 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir);

const usersFile = path.join(__dirname, 'users.json');
const profilesFile = path.join(__dirname, 'profiles.json');
const pvMessagesFile = path.join(__dirname, 'pv_messages.json');
const groupsFile = path.join(__dirname, 'groups.json');
const reactionsFile = path.join(__dirname, 'reactions.json');

fs.writeFileSync(usersFile, JSON.stringify({ "ibiu": "Raq111" }, null, 2));
fs.writeFileSync(profilesFile, JSON.stringify({ "ibiu": { avatar: "", bio: "" } }, null, 2));
fs.writeFileSync(pvMessagesFile, JSON.stringify({}, null, 2));
fs.writeFileSync(groupsFile, JSON.stringify({ "ibiu-news": { admin: "ibiu", members: [], messages: [] } }, null, 2));
fs.writeFileSync(reactionsFile, JSON.stringify({}, null, 2));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use('/avatars', express.static(avatarsDir));

app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat', 'index.html')));
app.get('/api/users', (req, res) => res.json(Object.keys(loadJSON(usersFile))));

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) { return {}; } }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('register', (d) => {
        let users = loadJSON(usersFile);
        let u = (d.username || '').trim().toLowerCase();
        let p = (d.password || '').trim();
        if (!u || !p) return socket.emit('error-msg', 'Fill all fields.');
        if (u.length < 3) return socket.emit('error-msg', 'Username too short.');
        if (p.length < 4) return socket.emit('error-msg', 'Password too short.');
        if (users[u]) return socket.emit('error-msg', 'Username taken.');
        users[u] = p; saveJSON(usersFile, users);
        let prof = loadJSON(profilesFile); prof[u] = { avatar: "", bio: "" }; saveJSON(profilesFile, prof);
        let grp = loadJSON(groupsFile); grp['ibiu-news'].members.push(u); saveJSON(groupsFile, grp);
        socket.emit('register-ok', 'Account created! Sign in now.');
    });

    socket.on('login', (d) => {
        let users = loadJSON(usersFile);
        let u = (d.username || '').trim().toLowerCase();
        let p = (d.password || '').trim();
        if (!u || !p) return socket.emit('error-msg', 'Fill all fields.');
        if (!users[u]) return socket.emit('error-msg', 'Account not found.');
        if (users[u] !== p) return socket.emit('error-msg', 'Wrong password.');
        currentUser = u;
        socket.emit('login-ok', { username: u });
    });

    socket.on('search-user', (q) => {
        let users = loadJSON(usersFile);
        socket.emit('search-results', Object.keys(users).filter(k => k.includes((q||'').toLowerCase())));
    });

    socket.on('get-pv', (d) => {
        let k = [currentUser, d.with].sort().join('_');
        let msgs = loadJSON(pvMessagesFile); if (!msgs[k]) msgs[k] = [];
        socket.emit('pv-data', { messages: msgs[k], withUser: d.with });
    });

    socket.on('pv-msg', (d) => {
        if (!currentUser) return;
        let k = [currentUser, d.to].sort().join('_');
        let msgs = loadJSON(pvMessagesFile); if (!msgs[k]) msgs[k] = [];
        let m = { id: crypto.randomUUID(), from: currentUser, text: d.text, type: 'text', time: Date.now(), seen: false };
        msgs[k].push(m); saveJSON(pvMessagesFile, msgs);
        io.emit('pv-msg', { pvKey: k, msg: m });
    });

    socket.on('pv-file', (d) => {
        if (!currentUser) return;
        let k = [currentUser, d.to].sort().join('_');
        let fn = Date.now() + '_' + d.name;
        try {
            fs.writeFileSync(path.join(uploadDir, fn), Buffer.from(new Uint8Array(d.data)));
            let msgs = loadJSON(pvMessagesFile); if (!msgs[k]) msgs[k] = [];
            let m = { id: crypto.randomUUID(), from: currentUser, type: 'file', fileName: d.name, fileUrl: '/uploads/'+fn, mime: d.mime, time: Date.now(), seen: false };
            msgs[k].push(m); saveJSON(pvMessagesFile, msgs);
            io.emit('pv-msg', { pvKey: k, msg: m });
        } catch(e) { socket.emit('error-msg', 'Upload failed.'); }
    });

    socket.on('pv-voice', (d) => {
        if (!currentUser) return;
        let k = [currentUser, d.to].sort().join('_');
        let fn = 'voice_'+Date.now()+'.webm';
        try {
            fs.writeFileSync(path.join(uploadDir, fn), Buffer.from(new Uint8Array(d.data)));
            let msgs = loadJSON(pvMessagesFile); if (!msgs[k]) msgs[k] = [];
            let m = { id: crypto.randomUUID(), from: currentUser, type: 'voice', fileUrl: '/uploads/'+fn, time: Date.now(), seen: false };
            msgs[k].push(m); saveJSON(pvMessagesFile, msgs);
            io.emit('pv-msg', { pvKey: k, msg: m });
        } catch(e) { socket.emit('error-msg', 'Voice failed.'); }
    });

    socket.on('group-msg', (d) => {
        if (currentUser !== 'ibiu') return socket.emit('error-msg', 'Only admin can post.');
        let grp = loadJSON(groupsFile);
        let m = { id: crypto.randomUUID(), from: 'ibiu', text: d.text, type: 'text', time: Date.now(), views: [] };
        grp['ibiu-news'].messages.push(m); saveJSON(groupsFile, grp);
        io.emit('group-msg', { group: 'ibiu-news', msg: m });
    });

    socket.on('delete-msg', (d) => {
        let msgs = loadJSON(pvMessagesFile);
        if (msgs[d.pvKey]) { msgs[d.pvKey] = msgs[d.pvKey].filter(m => m.id !== d.msgId); saveJSON(pvMessagesFile, msgs); }
        io.emit('message-deleted', { pvKey: d.pvKey, msgId: d.msgId });
    });

    socket.on('update-avatar', (d) => {
        if (!currentUser) return;
        let fn = 'avatar_'+currentUser+'_'+Date.now()+'.jpg';
        try {
            fs.writeFileSync(path.join(avatarsDir, fn), Buffer.from(new Uint8Array(d.data)));
            let prof = loadJSON(profilesFile); if (!prof[currentUser]) prof[currentUser] = { avatar: "", bio: "" };
            prof[currentUser].avatar = '/avatars/'+fn; saveJSON(profilesFile, prof);
            socket.emit('avatar-updated', '/avatars/'+fn);
        } catch(e) { socket.emit('error-msg', 'Avatar failed.'); }
    });

    socket.on('get-profile', () => {
        let prof = loadJSON(profilesFile);
        socket.emit('profile-data', { username: currentUser, avatar: prof[currentUser] ? prof[currentUser].avatar : '' });
    });

    socket.on('get-info', () => {
        let users = loadJSON(usersFile);
        socket.emit('info-data', { username: currentUser, password: users[currentUser] || '' });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Ready'));