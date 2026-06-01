const http = require('http');

setInterval(function() {
    http.get('https://ibiu-space.onrender.com', function(res) {
        console.log('Ping: ' + res.statusCode);
    });
}, 600000);

console.log('Keepalive started...');