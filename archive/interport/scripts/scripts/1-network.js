window.URL = window.URL || window.webkitURL;
window.isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);


window.addEventListener("beforeunload", function(event) { 
    console.log("window beforeunload")
    }
);

window.addEventListener('unload', function(event) { 
    console.log("window unload")
    }
);

window.addEventListener('pagehide', function(event) { 
    console.log("window pagehide")
    }
);

document.addEventListener('pagehide', function(event) { 
    console.log("document pagehide")
    }
);

class ServerConnection {

    constructor() {
        this._connect();
        Events.on('beforeunload', e => this._disconnect());
        Events.on('unload', e => this._disconnect());
        Events.on('pagehide', e => this._disconnect());
        Events.on('left', e => this.send(e.detail));
        window.addEventListener('visibilitychange', e => this._onVisibilityChange());
    }

    _connect() {
        clearTimeout(this._reconnectTimer);
        if (this._isConnected() || this._isConnecting()) return;
        const ws = new WebSocket(this._endpoint());
        ws.binaryType = 'arraybuffer';
        ws.onopen = e => console.log('WS: server connected');
        ws.onmessage = e => this._onMessage(e.data);
        ws.onclose = e => this._onDisconnect();
        ws.onerror = e => console.error(e);
        this._socket = ws;
    }

    _onMessage(msg) {
        msg = JSON.parse(msg);
        console.log('WS:', msg);
        switch (msg.type) {
            case 'peers':
                Events.fire('peers', msg.peers);
                break;
            case 'peer-joined':
                Events.fire('peer-joined', msg.peer);
                break;
            case 'peer-left':
                Events.fire('peer-left', msg.peerId);
                break;
            case 'signal':
                Events.fire('signal', msg);
                break;
            case 'ping':
                this.send({ type: 'pong' });
                break;
            case 'display-name':
                Events.fire('display-name', msg);
                break;
            default:
                console.error('WS: unkown message type', msg);
        }
    }

    send(message) {
        if (!this._isConnected()) return;
        this._socket.send(JSON.stringify(message));
    }

    _endpoint() {
        // hack to detect if deployment or development environment
        const protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
        const webrtc = window.isRtcSupported ? '/webrtc' : '/fallback';
        const url = protocol + '://' + location.host + webrtc;
        console.log(url);
        return url;
    }

    _disconnect() {
        console.log("disconnecting");
        this.send({ type: 'disconnect' });
        this._socket.onclose = null;
        this._socket.close();
        if (sessionToggle.method == "xApp") {closeXapp();}
    }

    _onDisconnect() {
        console.log("on disconnecting....");
        console.log('WS: server disconnected');
        Events.fire('notify-user', 'Connection lost. Retry in 5 seconds...');
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(_ => this._connect(), 5000);
    }

    _onVisibilityChange() {
        if (document.hidden) return;
            this._connect();
    }

    _isConnected() {
        return this._socket && this._socket.readyState === this._socket.OPEN;
    }

    _isConnecting() {
        return this._socket && this._socket.readyState === this._socket.CONNECTING;
    }
}

class Peer {

    constructor(serverConnection, peerId) {
        this._server = serverConnection;
        this._peerId = peerId;
        this._filesQueue = [];
        this._busy = false;
    }

    sendJSON(message) {
        this._send(JSON.stringify(message));
    }

    sendFiles(files) {
        for (let i = 0; i < files.length; i++) {
            this._filesQueue.push(files[i]);
        }
        if (this._busy) return;
        this._dequeueFile();
    }

    _dequeueFile() {
        if (!this._filesQueue.length) return;
        this._busy = true;
        const file = this._filesQueue.shift();
        this._sendFile(file);
    }

    _sendFile(file) {
        this.sendJSON({
            type: 'header',
            name: file.name,
            mime: file.type,
            size: file.size
        });
        this._chunker = new FileChunker(file,
            chunk => this._send(chunk),
            offset => this._onPartitionEnd(offset));
        this._chunker.nextPartition();
    }

    _onPartitionEnd(offset) {
        this.sendJSON({ type: 'partition', offset: offset });
    }

    _onReceivedPartitionEnd(offset) {
        this.sendJSON({ type: 'partition-received', offset: offset });
    }

    _sendNextPartition() {
        if (!this._chunker || this._chunker.isFileEnd()) return;
        this._chunker.nextPartition();
    }

    _sendProgress(progress) {
        this.sendJSON({ type: 'progress', progress: progress });
    }

    _onMessage(message) {
        if (typeof message !== 'string') {
            this._onChunkReceived(message);
            return;
        }
        message = JSON.parse(message);
        console.log('RTC:', message);
        switch (message.type) {
            case 'header':
                this._onFileHeader(message);
                break;
            case 'partition':
                this._onReceivedPartitionEnd(message);
                break;
            case 'partition-received':
                this._sendNextPartition();
                break;
            case 'progress':
                this._onDownloadProgress(message.progress);
                break;
            case 'transfer-complete':
                this._onTransferCompleted();
                break;
            case 'text':
                this._onTextReceived(message);
                break;
            case 'pay':
                this._onPayReceived(message);
                break;
            case 'change':
                this._onPeerChange(message);
                break;
        }
    }

    _onFileHeader(header) {
        this._lastProgress = 0;
        this._digester = new FileDigester({
            name: header.name,
            mime: header.mime,
            size: header.size
        }, file => this._onFileReceived(file));
    }


    sendText(message) {

        const unescaped_text = btoa(unescape(encodeURIComponent(message.text)));
        const unescaped_from = btoa(unescape(encodeURIComponent(message.from)));

        const data = {
            text:unescaped_text,
            from:unescaped_from
        }

        this.sendJSON({ type: 'text', message: data });

    }

    peerChange(message) {

        const unescaped_to = btoa(unescape(encodeURIComponent(message.to)));
        const unescaped_id = btoa(unescape(encodeURIComponent(message.from.id)));
        const unescaped_model = btoa(unescape(encodeURIComponent(message.from.model)));
        const unescaped_os = btoa(unescape(encodeURIComponent(message.from.os)));
        const unescaped_browser = btoa(unescape(encodeURIComponent(message.from.browser)));
        const unescaped_type = btoa(unescape(encodeURIComponent(message.from.type)));
        const unescaped_deviceName = btoa(unescape(encodeURIComponent(message.from.deviceName)));
        const unescaped_displayName = btoa(unescape(encodeURIComponent(message.from.displayName)));
        const unescaped_wallet= btoa(unescape(encodeURIComponent(message.from.wallet)));
        const unescaped_color= btoa(unescape(encodeURIComponent(message.from.color)));

        const data = {
            to:unescaped_to,
            id:unescaped_id,
            model:unescaped_model,
            os:unescaped_os,
            browser:unescaped_browser,
            type:unescaped_type,
            deviceName:unescaped_deviceName,
            displayName:unescaped_displayName,
            wallet:unescaped_wallet,
            color:unescaped_color,
        }

        this.sendJSON({ type: 'change', message: data});
    }

    _onPeerChange(message) {
        const escaped_to = decodeURIComponent(escape(atob(message.message.to)));
        const escaped_id = decodeURIComponent(escape(atob(message.message.id)));
        const escaped_model = decodeURIComponent(escape(atob(message.message.model)));
        const escaped_os = decodeURIComponent(escape(atob(message.message.os)));
        const escaped_browser = decodeURIComponent(escape(atob(message.message.browser)));
        const escaped_type = decodeURIComponent(escape(atob(message.message.type)));
        const escaped_deviceName = decodeURIComponent(escape(atob(message.message.deviceName)));
        const escaped_displayName = decodeURIComponent(escape(atob(message.message.displayName)));
        const escaped_wallet = decodeURIComponent(escape(atob(message.message.wallet)));
        const escaped_color = decodeURIComponent(escape(atob(message.message.color)));

        const data = {
            to:escaped_to,
            id:escaped_id,
            model:escaped_model,
            os:escaped_os,
            browser:escaped_browser,
            type:escaped_type,
            deviceName:escaped_deviceName,
            displayName:escaped_displayName,
            wallet:escaped_wallet,
            color:escaped_color,
        }

        console.log("this is the change peer message", data);
        
        Events.fire('change-peer', { message: data});
    }

    sendPay(message) {
        const unescaped_to = btoa(unescape(encodeURIComponent(message.to)));
        const unescaped_dest = btoa(unescape(encodeURIComponent(message.destination)));
        const unescaped_amount = btoa(unescape(encodeURIComponent(message.amount)));
        const unescaped_from = btoa(unescape(encodeURIComponent(message.from)));
        const unescaped_id = btoa(unescape(encodeURIComponent(message.id)));
        const unescaped_alias = btoa(unescape(encodeURIComponent(message.alias)));

        const data = {
            to:unescaped_to ,
            destination:unescaped_dest,
            amount:unescaped_amount ,
            from:unescaped_from,
            id:unescaped_id,
            alias:unescaped_alias
        }

        this.sendJSON({ type: 'pay', message: data});
    }

    _onTextReceived(message) {
        const escaped_text = decodeURIComponent(escape(atob(message.message.text)));
        const escaped_from = decodeURIComponent(escape(atob(message.message.from)));

        const data = {
            text:escaped_text,
            from:escaped_from
        }

        Events.fire('text-received', { message: data, sender: this._peerId });
    }

    _onPayReceived(message) {

        const escaped_to = decodeURIComponent(escape(atob(message.message.to)));
        const escaped_dest = decodeURIComponent(escape(atob(message.message.destination)));
        const escaped_amount = decodeURIComponent(escape(atob(message.message.amount)));
        const escaped_from = decodeURIComponent(escape(atob(message.message.from)));
        const escaped_id = decodeURIComponent(escape(atob(message.message.id)));
        const escaped_alias = decodeURIComponent(escape(atob(message.message.alias)));

        const data = {
            to:escaped_to ,
            destination:escaped_dest,
            amount:escaped_amount ,
            from:escaped_from,
            id:escaped_id,
            alias:escaped_alias
        }
        
        Events.fire('pay-received', { message: data});
    }

}

class RTCPeer extends Peer {

    constructor(serverConnection, peerId) {
        super(serverConnection, peerId);
        if (!peerId) return; // we will listen for a caller
        this._connect(peerId, true);
    }

    _connect(peerId, isCaller) {
        if (!this._conn) this._openConnection(peerId, isCaller);

        if (isCaller) {
            this._openChannel();
        } else {
            this._conn.ondatachannel = e => this._onChannelOpened(e);
        }
    }

    _openConnection(peerId, isCaller) {
        this._isCaller = isCaller;
        this._peerId = peerId;
        this._conn = new RTCPeerConnection(RTCPeer.config);
        this._conn.onicecandidate = e => this._onIceCandidate(e);
        this._conn.onconnectionstatechange = e => this._onConnectionStateChange(e);
        this._conn.oniceconnectionstatechange = e => this._onIceConnectionStateChange(e);
    }

    _openChannel() {
        const channel = this._conn.createDataChannel('data-channel', { 
            ordered: true,
            reliable: true // Obsolete. See https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/reliable
        });
        channel.binaryType = 'arraybuffer';
        channel.onopen = e => this._onChannelOpened(e);
        this._conn.createOffer().then(d => this._onDescription(d)).catch(e => this._onError(e));
    }

    _onDescription(description) {
        // description.sdp = description.sdp.replace('b=AS:30', 'b=AS:1638400');
        this._conn.setLocalDescription(description)
            .then(_ => this._sendSignal({ sdp: description }))
            .catch(e => this._onError(e));
    }

    _onIceCandidate(event) {
        if (!event.candidate) return;
        this._sendSignal({ ice: event.candidate });
    }

    onServerMessage(message) {
        if (!this._conn) this._connect(message.sender, false);

        if (message.sdp) {
            this._conn.setRemoteDescription(new RTCSessionDescription(message.sdp))
                .then( _ => {
                    if (message.sdp.type === 'offer') {
                        return this._conn.createAnswer()
                            .then(d => this._onDescription(d));
                    }
                })
                .catch(e => this._onError(e));
        } else if (message.ice) {
            this._conn.addIceCandidate(new RTCIceCandidate(message.ice));
        }
    }

    _onChannelOpened(event) {

        console.log('RTC: channel opened with', this._peerId);
        Events.fire('request-info', this._peerId);

        const channel = event.channel || event.target;
        channel.onmessage = e => this._onMessage(e.data);
        channel.onclose = e => this._onChannelClosed();
        this._channel = channel;
    }

    _onChannelClosed() {
        console.log('RTC: channel closed', this._peerId);
        //Events.fire('left', { type: 'left', id: this._peerId});
        
        if (!this.isCaller) return;

        //this._connect(this._peerId, true); // reopen the channel
    }

    _onConnectionStateChange(e) {
        console.log('RTC: state changed:', this._conn.connectionState);
        switch (this._conn.connectionState) {
            case 'disconnected':
                this._onChannelClosed();
                break;
            case 'failed':
                this._conn = null;
                this._onChannelClosed();
                break;
        }
    }

    _onIceConnectionStateChange() {
        switch (this._conn.iceConnectionState) {
            case 'failed':
                console.error('ICE Gathering failed');
                break;
            default:
                console.log('ICE Gathering', this._conn.iceConnectionState);
        }
    }

    _onError(error) {
        console.error(error);
    }

    _send(message) {
        if (!this._channel) return this.refresh();
        this._channel.send(message);
    }

    _sendSignal(signal) {
        signal.type = 'signal';
        signal.to = this._peerId;
        this._server.send(signal);
    }

    refresh() {
        // check if channel is open. otherwise create one
        if (this._isConnected() || this._isConnecting()) return;
        this._connect(this._peerId, this._isCaller);
    }

    _isConnected() {
        return this._channel && this._channel.readyState === 'open';
    }

    _isConnecting() {
        return this._channel && this._channel.readyState === 'connecting';
    }
}

class PeersManager {

    constructor(serverConnection) {
        this.peers = {};
        this._server = serverConnection;
        Events.on('signal', e => this._onMessage(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('files-selected', e => this._onFilesSelected(e.detail));
        Events.on('send-text', e => this._onSendText(e.detail));
        Events.on('send-pay', e => this._onSendPay(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peer-change', e => this._onPeerChange(e.detail));
    }

    _onMessage(message) {
        if (!this.peers[message.sender]) {
            this.peers[message.sender] = new RTCPeer(this._server);
        }
        this.peers[message.sender].onServerMessage(message);
    }

    _onPeers(peers) {

        console.log("Logging peers on peer", peers);

        peers.forEach(peer => {
            if (this.peers[peer.id]) {
                this.peers[peer.id].refresh();
                return;
            }
            if (window.isRtcSupported && peer.rtcSupported) {
                this.peers[peer.id] = new RTCPeer(this._server, peer.id);
            } else {
                this.peers[peer.id] = new WSPeer(this._server, peer.id);
            }
        })
    }

    sendTo(peerId, message) {
        this.peers[peerId].send(message);
    }

    _onFilesSelected(message) {
        this.peers[message.to].sendFiles(message.files);
    }

    _onSendText(message) {
        console.log("This is the message", message)
        this.peers[message.to].sendText(message);
    }

    _onSendPay(message) {
        this.peers[message.to].sendPay(message);
    }

    async _onPeerChange(message) {
        console.log("Logging room of peers" , this.peers);
        console.log("This is the message" , message);
        /*
        if (this.peers[message.to] == undefined ) {
            console.log("The peer has not been added to the room yet, rerunning")
            await delay();
            Events.fire('peer-change', message);
        }
        */

        //if (this.peers[message.to] != undefined ) {
            console.log("Sending the message")
            this.peers[message.to].peerChange(message);
       // }
    }

    _onPeerLeft(peerId) {
        const peer = this.peers[peerId];
        delete this.peers[peerId];
        if (!peer || !peer._peer) return;
        peer._peer.close();
    }

}

class WSPeer {
    _send(message) {
        message.to = this._peerId;
        this._server.send(message);
    }
}


class Events {
    static fire(type, detail) {
        window.dispatchEvent(new CustomEvent(type, { detail: detail }));
    }

    static on(type, callback) {
        return window.addEventListener(type, callback, false);
    }
}


RTCPeer.config = {
    'sdpSemantics': 'unified-plan',
    'iceServers': [
        {urls: 'stun:stun.l.google.com:19302'}
    ]
}

/*
function delay () {
    return new Promise((resolve, reject) => {
         setTimeout(resolve, 5000);
     })
 };
*/