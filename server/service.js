var Service = require('node-windows').Service;

// Create a new service object
var svc = new Service({
    name: 'RtcWebSocketServer',
    description: 'This is the websocket server for web chat video call',
    script: 'C:\\WebrtcVideoCall\\server.js'
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function () {
    svc.start();
});

svc.install();