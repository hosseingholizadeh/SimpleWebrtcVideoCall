var winston = require('winston');
require('winston-daily-rotate-file');

var transport = new winston.transports.DailyRotateFile({
    dirname:"H://logs/rtc-server/",
    filename: 'webchat-videocall-%DATE%.log',
    datePattern: 'YYYY-MM-DD-HH',
    zippedArchive: true,
    timestamp: true,
    maxSize: '20m',
    maxFiles: '14d'
});

var log = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp}[${info.level}]: ${info.message}` + (info.splat !== undefined ? `${info.splat}` : " "))
    ),
    transports: [
        transport
    ]
});

const WebSocket = require('ws').Server;
const wss = new WebSocket({
    server: 'localhost',
    port: 9055
});

log.info('websocket server started on http://localhost:9055');
log.info('please check the IIS re-write roles');

const conf = {
    wsMessageType: {
        GIVE_OFFER: "give-offer",
        OFFER: "offer",
        ANSWER: "answer",
        LOGIN: "login",
        CANDIDATE: "candidate",
        MEDIA_STATE_CHANGED: "media-state-changed",
        SHARE_SCREEN_STARTED: "share-screen-started",
        SHARE_SCREEN_STOPPED: "share-screen-stopped",
        RE_NEGOTIATE: "re-negotiate",
        REJECT: "reject",
        LEAVE: "leave"
    }
};

//all connected to the server users 
var users = {};

//when a user connects to our sever 
wss.on('connection', function (connection) {

    log.info("User connected");

    //when server gets a message from a connected user 
    connection.on('message', function (message) {

        let data;

        //accepting only JSON messages 
        try {
            data = JSON.parse(message);
        } catch (e) {
            log.error("Invalid JSON");
            data = {};
        }

        switch (data.type) {
            case conf.wsMessageType.LOGIN:
                handleLogin(connection, data);
                break;
            case conf.wsMessageType.GIVE_OFFER:
                handleGiveOffer(connection, data);
                break;
            case conf.wsMessageType.OFFER:
                handleOffer(connection, data);
                break;
            case conf.wsMessageType.ANSWER:
                handleAnswer(connection, data);
                break;
            case conf.wsMessageType.CANDIDATE:
                handlecandidate(data);
                break;
            case conf.wsMessageType.RE_NEGOTIATE:
                handleReNegotiate(data);
                break;
            case conf.wsMessageType.MEDIA_STATE_CHANGED:
            case conf.wsMessageType.SHARE_SCREEN_STARTED:
            case conf.wsMessageType.SHARE_SCREEN_STOPPED:
                SendToClient(data);
                break;
            case conf.wsMessageType.LEAVE:
                handleleave(data);
                break;
            default:
                log.error("[ERROR]Command not found: " + data.type);
                sendTo(connection, {
                    type: "error",
                    message: "Command not found: " + data.type
                });
                break;
        }
    });

    //when user exits, for example closes a browser window 
    //this may help if we are still in "offer","answer" or "candidate" state 
    connection.on("close", function () {

        if (connection.name) {
            log.info("user " + connection.name + " is disconnected");
            delete users[connection.name];
        }

    });
});

function handleLogin(connection, data) {
    log.info("User logged ", data.name);

    //if anyone is logged in with this username then refuse 
    if (users[data.name]) {
        log.info("user already exists ", data.name);
        sendTo(connection, {
            type: "login",
            message: "user already exists",
            success: false
        });
    } else {
        users[data.name] = connection;
        connection.name = data.name;

        sendTo(connection, {
            type: "login",
            success: true
        });
    }
}

function setOtherPartyLogin(connection, data) {
    var conn = users[connection.otherName];
    if (conn) {
        sendTo(conn, {
            type: "leave"
        });
    }
}

function handleGiveOffer(connection, data) {
    log.info("Sending give-offer to: ", data.name);

    let conn = users[data.name];
    if (conn) {
        connection.otherName = data.name;
        sendTo(conn, {
            type: "give-offer"
        });
    }
}

function handleOffer(connection, data) {
    log.info("Sending offer to: ", data.name);

    let conn = users[data.name];
    if (conn) {
        sendTo(conn, {
            type: "offer",
            offer: data.offer,
            name: connection.name
        });
    }
}

function handleAnswer(connection, data) {
    log.info("Sending answer to: ", data.name);
    let conn = users[data.name];
    if (conn) {
        connection.otherName = data.name;
        sendTo(conn, {
            type: "answer",
            answer: data.answer
        });
    }
}

function SendToClient(data) {
    let conn = users[data.name];
    if (conn) {
        sendTo(conn, data);
    }
}
function handleReNegotiate(data) {
    log.info("Sending handleReNegotiate to: ", data.name);
    let conn = users[data.name];
    if (conn) {
        sendTo(conn, data);
    }
}

function handleleave(data) {
    log.info("Disconnecting from", data.name);
    let conn = users[data.name];
    if (conn) {
        conn.otherName = null;
        sendTo(conn, {
            type: "leave"
        });
    }
}

function handlecandidate(data) {
    log.info("Sending candidate to:", data.name);
    let conn = users[data.name];
    if (conn) {
        sendTo(conn, {
            type: "candidate",
            candidate: data.candidate
        });
    }
}

function sendTo(connection, message) {
    try {
        connection.send(JSON.stringify(message));
    } catch (e) {
        console.error(e);
    }
}