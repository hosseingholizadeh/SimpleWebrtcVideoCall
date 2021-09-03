const conf = {
    wsServer: "ws://localhost:9055",
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

var rtcConn = null,
    wsConn = null,
    localVideo = null,
    remoteVideo = null,
    displayMediaStream = null,
    muteVoiceBtn = null,
    muteVideoBtn = null,
    localVoiceMuteSpan = null,
    localVideoMuteImage = null,
    remoteVoiceMuteSpan = null,
    remoteVideoMuteImage = null,
    phoneRingAudio = null,
    dropDownBtn = null,
    startScreenShareBtn = null,
    mediaConstraints = null,
    stopScreenShareBtn = null,
    localStream = null,
    call = null,
    locaMuted = false,
    wsClosed = false,
    remoteDesSet = false,
    senders = [],
    candidates = null,
    hangupBtn = null;

function Queue() {
    this.elements = [];
}

Queue.prototype.enqueue = function (e) {
    this.elements.push(e);
};

Queue.prototype.dequeue = function () {
    return this.elements.shift();
};

Queue.prototype.isEmpty = function () {
    return this.elements.length === 0;
};

Queue.prototype.peek = function () {
    return !this.isEmpty() ? this.elements[0] : undefined;
};

Queue.prototype.length = function () {
    return this.elements.length;
};

async function makeCall() {
    console.log("making call");
    const offer = await rtcConn.createOffer();
    await rtcConn.setLocalDescription(offer);
    send({ type: conf.wsMessageType.OFFER, offer: offer });
    console.log("call made");
    call.firstMade = true;
}

function hangupCall() {
    remoteVideo.src = null;

    rtcConn.close();
    rtcConn.onicecandidate = null;
    rtcConn.ontrack = null;

    send({
        type: conf.wsMessageType.LEAVE
    });

    setTimeout(function () { window.close(); }, 1000);
}

//when somebody sends us an offer 
async function handleOffer(offer) {
    await rtcConn.setRemoteDescription(new RTCSessionDescription(offer));

    //create an answer to an offer 
    let answer = await rtcConn.createAnswer();
    await rtcConn.setLocalDescription(answer);

    console.log("remote description is set");
    await setCandidates();
    remoteDesSet = true;
    send({
        type: conf.wsMessageType.ANSWER,
        answer: answer
    });
}

async function handleAnswer(answer) {
    const remoteDesc = new RTCSessionDescription(answer);
    await rtcConn.setRemoteDescription(remoteDesc);
    console.log("remote description is set");
    await setCandidates();
    remoteDesSet = true;
    stopRingingPhone();
}

//we must set the candidate after setting the remote description 
async function handleReNegotiate(data) {
    const remoteDesc = new RTCSessionDescription(data.sdp);
    await rtcConn.setRemoteDescription(remoteDesc);
    await setCandidates();
}

function addCandidateToQueue(candidate) {
    candidates.enqueue(candidate);
}

async function setCandidates() {
    let candidate = candidates.dequeue();
    while (candidate) {
        await rtcConn.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("candidate is set");
        candidate = candidates.dequeue();
    }
}

async function handleCandidate(candidate) {
    if (remoteDesSet === false) return addCandidateToQueue(candidate);
    await rtcConn.addIceCandidate(new RTCIceCandidate(candidate));
    console.log("candidate is set");
}

function handleLeave() {
    remoteVideo.src = null;

    rtcConn.close();
    rtcConn.onicecandidate = null;
    rtcConn.ontrack = null;
    setTimeout(function () { window.close(); }, 1500);
    wsClosed = true;
    wsConn.terminate();
}

function createPeerConnection() {
    try {
        if (rtcConn) return;

        const configuration = {/* 'iceServers': [{ 'urls': 'stun:stunserver.com' }], */"optional": [{ "DtlsSrtpKeyAgreement": true }] };
        rtcConn = new RTCPeerConnection(configuration);
        rtcConn.onicecandidate = function (event) {
            if (event.candidate) {
                console.log("sending candidate " + event.candidate);
                send({
                    type: conf.wsMessageType.CANDIDATE,
                    candidate: event.candidate
                });
            }
        };
    } catch (e) {
        console.log(e.toString());
        rtcConn = null;
        return;
    }

    startAddRemoteTracks();
}

function startAddRemoteTracks() {
    rtcConn.ontrack = ({ track, streams: [stream] }) => {
        remoteVideo.srcObject = stream;
        track.onunmute = () => {
            if (!remoteVideo.srcObject)
                remoteVideo.srcObject = new MediaStream([track]);
            else {
                let kind = track.kind;
                console.log("track type " + kind + " onmuted");
                let trackIsSet = false;
                remoteVideo.srcObject.getTracks().forEach(t => {
                    if (t.kind === kind) {
                        t = track;
                        trackIsSet = true;
                    }
                });

                if (!trackIsSet)
                    remoteVideo.srcObject.addTrack(track);
            }
        };

        if (stream)
            stream.onremovetrack = ({ track }) => {
                console.log(`${track.kind} track was removed.`);
                if (!stream.getTracks().length) {
                    console.log(`stream ${stream.id} emptied (effectively removed).`);
                }
            };
    };
}

function toggleVideo() {
    toggleTrack('video', muteVideoBtn);
}

function muteVideo() {
    let videoTrack;
    rtcConn.getSenders().forEach(function (sender) {
        if (sender.track !== null && sender.track.kind === 'video') {
            videoTrack = sender;
            videoTrack.track.stop();
        }
    });

    if (videoTrack)
        rtcConn.removeTrack(videoTrack);

    muteVideoBtn.onclick = unMuteVideo;
    toggleStyle(muteVideoBtn, 'video', false);
    send({ type: conf.wsMessageType.MEDIA_STATE_CHANGED, mediaType: 'video', muted: true });
}

function unMuteVideo() {
    if (call.isVideoCall || call.firstUnmuteDone)
        getMedia(true, reSetStream);
    else {
        getMedia(true, reSetStream);
        call.firstUnmuteDone = true;
    }
}

function toggleAudio() {
    localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
        toggleStyle(muteVoiceBtn, 'audio', track.enabled);
        send({ type: conf.wsMessageType.MEDIA_STATE_CHANGED, mediaType: 'audio', muted: !track.enabled });
    });
}

function handleMediaStateChanged(type, muted) {
    if (!muted) {
        if (type === 'video') {
            remoteVideoMuteImage.style.display = "none";
            remoteVideo.style.display = "block";
        } else if (type === 'audio') {
            remoteVoiceMuteSpan.style.display = "none";
        }

    } else {
        if (type === 'video') {
            remoteVideoMuteImage.style.display = "block";
            remoteVideo.style.display = "none";
        } else if (type === 'audio') {
            remoteVoiceMuteSpan.style.display = "block";
        }
    }
}

function toggleStyle(e, type, enabled) {
    if (enabled) {
        e.style.backgroundColor = "transparent";
        e.style.color = "#ffffff";
        if (type === 'video') {
            localVideoMuteImage.style.display = "none";
        } else if (type === 'audio') {
            localVoiceMuteSpan.style.display = "none";
        }

    } else {
        e.style.backgroundColor = "#ffffff";
        e.style.color = "#000";
        if (type === 'video') {
            localVideoMuteImage.style.display = "block";
        } else if (type === 'audio') {
            localVoiceMuteSpan.style.display = "block";
        }
    }
}

function restartGetLocalStream(stream) {
    localStream = stream;
    localVideo.srcObject = localStream;
    localVideo.volume = 0.0;
    localStream.getTracks().forEach(track => rtcConn.addTrack(
        track,
        stream,
    ));
}

function reSetStream(stream) {
    console.log("re-set the local stream");
    localStream = stream;
    localVideo.srcObject = localStream;
    localVideo.volume = 0.0;
    let videoIsSet = false;
    rtcConn.getSenders().forEach(sender => {
        if (sender.track === null || sender.track.kind === 'video') {
            sender.replaceTrack(localStream.getVideoTracks()[0]);

            videoIsSet = true;
            muteVideoBtn.onclick = muteVideo;
            toggleStyle(muteVideoBtn, 'video', true);
            send({ type: conf.wsMessageType.MEDIA_STATE_CHANGED, mediaType: 'video', muted: false });
        }
    });

    if (videoIsSet === false) {
        let transceiver = rtcConn.addTransceiver('video');
        let { sender } = transceiver;
        sender.replaceTrack(localStream.getVideoTracks()[0]);
        makeCall();
    }
}

async function gotStream(stream) {
    localStream = stream;
    localVideo.srcObject = localStream;
    localVideo.volume = 0.0;
    createPeerConnection();
    localStream.getTracks()
        .forEach(track => senders.push(rtcConn.addTrack(
            track,
            stream,
        )));

    if (!call.isVideoCall) {
        //muteVideo();
        muteVideoBtn.onclick = unMuteVideo;
    }
    else
        muteVideoBtn.onclick = muteVideo;

    if (call.offer)
        send({ type: conf.wsMessageType.GIVE_OFFER });
    else
        ringPhone();
}

function initialize() {
    if (rtcConn) return;
    getMedia(call.isVideoCall);
}

function getMediaError(error, success, forceAudio) {
    if (error)
        console.log(error.name + ": " + error.message);

    return navigator.mediaDevices.enumerateDevices()
        .then(function (devices) {
            var cam = devices.find(function (device) {
                return device.kind === 'videoinput';
            });
            console.log(cam);

            var mic = devices.find(function (device) {
                return device.kind === 'audioinput';
            });
            console.log(mic);

            var constraints = {
                video: cam && mediaConstraints.video && !forceAudio,
                audio: mic && mediaConstraints.audio
            };

            if (navigator.mediaDevices.getUserMedia === undefined) {
                navigator.mediaDevices.getUserMedia = function (constraints) {

                    // First get ahold of the legacy getUserMedia, if present
                    var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

                    // Some browsers just don't implement it - return a rejected promise with an error
                    // to keep a consistent interface
                    if (!getUserMedia) {
                        return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
                    }

                    // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
                    return new Promise(function (resolve, reject) {
                        getUserMedia.call(navigator, constraints, resolve, reject);
                    });
                };
            }

            return navigator.mediaDevices.getUserMedia(constraints)
                .then(function (stream) {
                    success(stream);
                })
                .catch(function (err) {
                    console.error("could not connect to your media device " + err.message);
                    getMediaError(err, success, true);
                });
        });
}

function getMedia(hasVideo, success) {
    if (!success)
        success = gotStream;
    mediaConstraints =
    {
        "audio": {
            "mandatory": {
                "googEchoCancellation": "true",
                "googAutoGainControl": "true",
                "googNoiseSuppression": "true",
                "googHighpassFilter": "true"
            },
            "optional": []
        },
        "video": hasVideo
    };

    if (navigator.mediaDevices === undefined) {
        navigator.mediaDevices = {};
    }

    if (navigator.mediaDevices.getUserMedia === undefined) {
        navigator.mediaDevices.getUserMedia = function (constraints) {
            var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
            if (!getUserMedia) {
                return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
            }

            return new Promise(function (resolve, reject) {
                getUserMedia.call(navigator, constraints, resolve, reject);
            });
        };
    }

    navigator.mediaDevices.getUserMedia(mediaConstraints)
        .then(function (stream) {
            success(stream);
        })
        .catch(function (err) {
            getMediaError(err, success);
        });
}

function handleLogin(success) {
    if (!success) {
        console.error("websocket login was not successfull");
    } else {
        console.info("successfully logged in");
        initialize();
    }
}

function generateCallData() {
    call = {
        session: window.name,
        isVideoCall: getParameterByName("v", window.location.search) === "1",
        offer: getParameterByName("o", window.location.search) === "1"
    };
    console.log(call);

    connName = (call.offer ? "des-" : "src-") + call.session;
    otherPartyName = (!call.offer ? "des-" : "src-") + call.session;

    console.log("your name = " + connName);
    console.log("other party name = " + otherPartyName);
}

async function rtcMessageReceived(data) {
    console.log(data.type);
    switch (data.type) {
        case conf.wsMessageType.GIVE_OFFER:
            await makeCall();
            break;
        case conf.wsMessageType.LOGIN:
            await handleLogin(data.success);
            break;
        case conf.wsMessageType.OFFER:
            await handleOffer(data.offer);
            break;
        case conf.wsMessageType.ANSWER:
            await handleAnswer(data.answer);
            break;
        case conf.wsMessageType.CANDIDATE:
            await handleCandidate(data.candidate);
            break;
        case conf.wsMessageType.MEDIA_STATE_CHANGED:
            await handleMediaStateChanged(data.mediaType, data.muted);
            break;
        case conf.wsMessageType.RE_NEGOTIATE:
            handleReNegotiate(data);
            break;
        case conf.wsMessageType.SHARE_SCREEN_STARTED:
            toggleShareScreenVideo(true);
            break;
        case conf.wsMessageType.SHARE_SCREEN_STOPPED:
            toggleShareScreenVideo(false);
            break;
        case conf.wsMessageType.LEAVE:
        case conf.wsMessageType.REJECT:
            handleLeave();
            break;
        default:
    }
}

function connectWS() {
    wsConn = new WebSocket(conf.wsServer);
    wsConn.onopen = function () {
        console.log("Connected to the signaling server");
        generateCallData();
        send({ type: conf.wsMessageType.LOGIN, name: connName });
    };

    wsConn.onmessage = async function (msg) {
        await rtcMessageReceived(JSON.parse(msg.data));
    };

    wsConn.onerror = function (err) {
        console.log("Got error", err);
    };

    wsConn.onclose = function () {
        console.log('socket closed');
        if (!wsClosed)
            setTimeout(connectWS, 2000);
    };
}

function send(message) {
    if (otherPartyName && !message.name) {
        message.name = otherPartyName;
    }

    try {
        wsConn.send(JSON.stringify(message));
    } catch (e) {
        console.error(e);
    }
}

async function startDesktopSharing() {
    if (!displayMediaStream || !displayMediaStream.active) {
        displayMediaStream = await navigator.mediaDevices.getDisplayMedia();

        displayMediaStream.oninactive = function () {
            console.log("desktop share ended");
            stopDesktopSharing();
        };
    }
    rtcConn.getSenders().forEach(sender => {
        if (sender.track === null || sender.track.kind === 'video') {
            sender.lastState = sender.track === null ? "muted" : "unMuted";
            sender.replaceTrack(displayMediaStream.getTracks()[0]);

            if (sender.lastState === "muted")
                send({ type: conf.wsMessageType.MEDIA_STATE_CHANGED, mediaType: 'video', muted: false });
        }
    });

    localVideo.srcObject = displayMediaStream;
    startScreenShareBtn.style.display = 'none';
    stopScreenShareBtn.style.display = 'block';
    send({ type: conf.wsMessageType.SHARE_SCREEN_STARTED });
}

function stopDesktopSharing() {
    rtcConn.getSenders().forEach(sender => {
        if (sender.track === null || sender.track.kind === 'video') {
            if (sender.lastState === "muted") return muteVideo();
            sender.replaceTrack(localStream.getTracks().find(track => track.kind === 'video'));
        }
    });

    localVideo.srcObject = localStream;
    stopScreenShareBtn.style.display = 'none';
    startScreenShareBtn.style.display = 'block';
    send({ type: conf.wsMessageType.SHARE_SCREEN_STOPPED });
}

function toggleShareScreenVideo(started) {
    remoteVideo.style.transform = "scaleX(" + (started === true ? "1" : "-1") + ")";
}

function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function toggleDropDown() {
    document.getElementById("toolsMenu").classList.toggle("show");
}

function ringPhone() {
    if (phoneRingAudio) {
        if (phoneRingAudio.paused)
            phoneRingAudio.play();
        return false;
    }

    phoneRingAudio = new Audio('./Sounds/ring.mp3');
    phoneRingAudio.loop = true;
    phoneRingAudio.play();
}

function stopRingingPhone() {
    if (phoneRingAudio) {
        phoneRingAudio.pause();
    }
}

(function () {
    let localVideoContainer = document.getElementById('LocalVideoMuteContainer');
    localVideo = localVideoContainer.querySelector('#localsrc');
    localVoiceMuteSpan = localVideoContainer.querySelector('span[name="mutedVoice"]');
    localVideoMuteImage = localVideoContainer.querySelector('img');

    let remoteVideoContainer = document.getElementById('RemoteVideoMuteContainer');
    remoteVideo = remoteVideoContainer.querySelector('#remotesrc');
    remoteVoiceMuteSpan = remoteVideoContainer.querySelector('span[name="mutedVoice"]');
    remoteVideoMuteImage = remoteVideoContainer.querySelector('img');

    muteVideoBtn = document.getElementById('muteVideo');
    muteVoiceBtn = document.getElementById('muteVoice');
    hangupBtn = document.getElementById('hangup');
    document.querySelector(".dropbtn").onclick = toggleDropDown;
    dropDownBtn = document.getElementById('toolsMenu');
    startScreenShareBtn = dropDownBtn.querySelector('#screenShare');
    startScreenShareBtn.href = "javascript:startDesktopSharing();toggleDropDown();";

    stopScreenShareBtn = dropDownBtn.querySelector('#stop-screenShare');
    stopScreenShareBtn.href = "javascript:stopDesktopSharing();toggleDropDown();";

    candidates = new Queue();
    muteVoiceBtn.onclick = function () { toggleAudio(); };
    hangupBtn.onclick = function () { hangupCall(); };
    connectWS();
})();  