const $ = query => document.getElementById(query);
const $$ = query => document.body.querySelector(query);
//const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
window.isDownloadSupported = (typeof document.createElement('a').download !== 'undefined');
window.isProductionEnvironment = !window.location.host.startsWith('localhost');
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;


let colorArray = ['#fc7e63', '#55c3c2',  '#f9bc89', '#968ba5',  '#fa9397', '#c7ceea', '#b5ead7', '#f4cdf2', '#ffdac1', '#ffb7b2']
let i = Math.floor(colorArray.length*Math.random())
let randomColor = colorArray[i];

$('b').setAttribute('fill', randomColor);

function buttonText() {
    if($('aliasInput').innerHTML != '') {
        $('skip-button').innerHTML="Add"
    } else {
        $('skip-button').innerHTML="Skip"
    }
}

$('add-button').setAttribute('disabled', true);

//Set toggles to track user input and future signing methods
//As user selects a method, method is updated to method tyype
const sessionToggle={
    method: null,
}

var user_token

const me = {
        id: undefined,
        model: undefined,
        os: undefined,
        browser: undefined,
        type: undefined,
        deviceName: undefined,
        displayName: undefined,
        wallet: "Message Only",
        color: randomColor
};

const storedData = localStorage.getItem('session');
const userData = JSON.parse(storedData);
if (userData === null ) {
    console.log("localStroage is not set")
} else {
        if (userData.wallet != undefined) { me.wallet = userData.wallet};
        if (userData.alias != undefined) {me.displayName = userData.alias};
        if (userData.method != undefined) {sessionToggle.method = userData.method};
    }

class Me {
    constructor() {
        this.$displayName = $('displayName')
        this.$displayWallet = $('displayWallet')
        Events.on('display-name', e => this._onDisplayName(e.detail.message));
        Events.on('display-name', e => this._setMe(e.detail.message));
        Events.on('change-alias', e => this._onAliasChange(e.detail));
        Events.on('change-wallet', e => this._onWalletChange(e.detail));
        Events.on('change-device', e => this._onDeviceChange(e.detail));
    }

    _setMe(message) {

        console.log("This is setting me", message);

        if (me.displayName === undefined) me.displayName = message.displayName;
        if (me.deviceName === undefined) me.deviceName = message.deviceName;

        this.$displayName.textContent = 'You are known as ' + me.displayName;
        this.$displayName.title = me.deviceName;
        this.$displayWallet.textContent = me.wallet;
        };

    _onAliasChange(alias) {

        this.$displayName.textContent = 'You are now known as ' + alias ;
        me.displayName =  alias;

        Events.fire("display-set", me);
        };

    _onWalletChange(wallet) {

        console.log("Changing wallet", wallet);

        this.$displayWallet.textContent = wallet;
        me.wallet =  wallet;

        console.log("This is the global me", me);

        Events.fire("display-set", me);
        };

    _onDeviceChange(device) {

        console.log("Changing device", device);
        me.deviceName = device;
        Events.fire("display-set", me);
        };

    _onDisplayName(message) {

        var parser = new UAParser();
        this.ua = parser.getResult();
        console.log("THis is the ua", this.ua);


        if (me.displayName === undefined) me.displayName = message.displayName;
        if (me.deviceName === undefined) me.deviceName = message.deviceName;

        me.id = message.id;
        me.model = this.ua.device.model;
        me.os = this.ua.os.name;
        me.browser = this.ua.browser.name;
        me.type = this.ua.device.type;

        Events.fire('display-set', me);
    }
}

class PeersUI {

    constructor() {
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('change-peer', e => this._onPeerChange(e.detail.message));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('file-progress', e => this._onFileProgress(e.detail));
        Events.on('paste', e => this._onPaste(e));

        Events.on('request-info', e => this._onRequest(e.detail));
    }

    _onPeerJoined(peer) {

        if (me.color != undefined || me.id != undefined || me.wallet != undefined ) {
            Events.fire('peer-change', {to: peer.id, from: me});
        } 

        if ($(peer.id)) return; // peer already exists
        const peerUI = new PeerUI(peer);
        $$('x-peers').appendChild(peerUI.$el);
        setTimeout(e => window.animateBackground(false), 1750); // Stop animation

        if (me.color == undefined || me.id == undefined || me.wallet == undefined ) {
            setTimeout(e => Events.fire('peer-joined', peer), 1500);
        } 
    }

    _onRequest(peerId) {
        Events.fire('peer-change', {to:peerId, from: me});
    }

    _onPeers(peers) {
        this._clearPeers();
        peers.forEach(peer => {this._onPeerJoined(peer)})
    }

    _onPeerLeft(peerId) {
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.remove();
    }

    _onPeerChange(data) {
        console.log ("this is the peer change data", data);
        const $peer = $(data.id);
        $peer.remove();

        this.peer = {
            id: data.id,
            name: {
                browser: data.browser,
                color: data.color,
                deviceName: data.deviceName,
                displayName: data.displayName,
                type: data.type,
                os: data.os,
                wallet: data.wallet,
            }
        };

        const peerUI = new PeerUI(this.peer);
        $$('x-peers').appendChild(peerUI.$el);
    }

    _onFileProgress(progress) {
        const peerId = progress.sender || progress.recipient;
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.ui.setProgress(progress.progress);
    }

    _clearPeers() {
        const $peers = $$('x-peers').innerHTML = '';
    }

    _onPaste(e) {
        const files = e.clipboardData.files || e.clipboardData.items
            .filter(i => i.type.indexOf('image') > -1)
            .map(i => i.getAsFile());
        const peers = document.querySelectorAll('x-peer');
        // send the pasted image content to the only peer if there is one
        // otherwise, select the peer somehow by notifying the client that
        // "image data has been pasted, click the client to which to send it"
        // not implemented
        if (files.length > 0 && peers.length === 1) {
            Events.fire('files-selected', {
                files: files,
                to: $$('x-peer').id
            });
        }
    }
}

class UserUI {
    constructor() {
        const el = $$('#userIcon');
        this._bindListeners(el);
    }

    _bindListeners(el) {
        el.addEventListener('click', e => this._onUserClick(e));
        el.addEventListener('contextmenu', e => this._onRightClick(e));
        el.addEventListener('touchstart', e => this._onTouchStart(e));
        el.addEventListener('touchend', e => this._onTouchEnd(e));
        el.addEventListener('touch', e => this._onTouch(e));

    }

    _onUserClick(e) {
        e.preventDefault();

        const peers = document.querySelectorAll('x-peer');

        this.room = [];
        //this.room_size = peers.length;

        for (let i=0; i<peers.length; i++) {
            const info = JSON.parse((peers[i]).getAttribute('data-peer'))
            this.room.push(info);
            console.log(this.room);
        }
        
            if (this.$wallet == "Message Only" ) {
                Events.fire('message', {title: "Oops!", message: "You do not have payments enabled. \r\n\r\n Right click to send a message. \r\n Refresh window to restart and add wallet :P"})
            } else if ( this.room.length < 1  ) {
                Events.fire('message', {title: "Oops!", message: "Cricket.. cricket.. The room is empty. \r\n Open a port an another device :P"})
            } else if (this.room_size = this.room.length) 
                {Events.fire('pay-group', this.room)}
        }

    _onRightClick(e) {
        e.preventDefault();

        const peers = document.querySelectorAll('x-peer');
        this.room = [];

        for (let i=0; i<peers.length; i++) {
            const info = JSON.parse((peers[i]).getAttribute('data-peer'))
            this.room.push(info);
        }

        if ( this.room.length < 1  ) {
            Events.fire('message', {title: "Oops!", message: "Cricket.. cricket.. The room is empty. \r\n Open a port an another device :P"})
        } else {
            Events.fire('text-group', this.room);
        }
    }

    _onTouch(e) {
        e.preventDefault();

        const peers = document.querySelectorAll('x-peer');
        this.room = [];

        for (let i=0; i<peers.length; i++) {
            const info = JSON.parse((peers[i]).getAttribute('data-peer'))
            this.room.push(info);
        }

        if ( this.room.length < 1  ) {
            Events.fire('message', {title: "Oops!", message: "Cricket.. cricket.. The room is empty. \r\n Open a port an another device :P"})
        } else {
            Events.fire('text-group', this.room);
        }
    }

    _onTouchStart(e) {
        this._touchStart = Date.now();
        this._touchTimer = setTimeout(_ => this._onTouchEnd(), 610);
    }

    _onTouchEnd(e) {
        if (Date.now() - this._touchStart < 500) {
            clearTimeout(this._touchTimer);
        } else { // this was a long tap
            if (e) e.preventDefault();

            const peers = document.querySelectorAll('x-peer');

            this.room = [];
    
            for (let i=0; i<peers.length; i++) {
                const info = JSON.parse((peers[i]).getAttribute('data-peer'))
                this.room.push(info);
            }

            if ( this.room.length < 1  ) {
                Events.fire('message', {title: "Oops!", message: "Cricket.. cricket.. The room is empty. \r\n Open a port an another device :P"})
            } else {
                Events.fire('text-group', this.room);
            }

        }
    }
}

class PeerUI {

    html() {
        return `
            <label class="column center" title="Click to send payment or right click to send a message">
                <input type="file" multiple>
                <x-icon class ="circleColor"shadow="1">
                    <svg class="icon"><use xlink:href="#"/></svg>
                </x-icon>
                <div class="progress">
                  <div class="circle"></div>
                  <div class="circle right"></div>
                </div>
                <div class="name font-subheading"></div>
                <div class="device-name font-body2"></div>
                <div class="device-wallet font-body2"></div>
                <div class="status font-body2"></div>
            </label>`
    }

    constructor(peer) {
        this._peer = peer;
        this._initDom();
        this._bindListeners(this.$el);
    }

    _initDom() {
        const el = document.createElement('x-peer');
        el.id = this._peer.id;
        el.innerHTML = this.html();
        el.ui = this;
        el.querySelector('svg use').setAttribute('xlink:href', this._icon());
        el.querySelector('.name').textContent = this._displayName();
        el.querySelector('.circleColor').style.background =  this._circleColor();
        el.querySelector('.device-name').textContent = this._deviceName();
        el.querySelector('.device-wallet').textContent = this._deviceWallet();
        el.dataset.peer = this._peerData();
        this.$el = el;
        this.$progress = el.querySelector('.progress');
    }


    _bindListeners(el) {
        el.addEventListener('submit', e => this._onSubmit(e));
        el.addEventListener('click', e => this._onPayClick(e));
        el.addEventListener('drop', e => this._onDrop(e));
        el.addEventListener('dragend', e => this._onDragEnd(e));
        el.addEventListener('dragleave', e => this._onDragEnd(e));
        el.addEventListener('dragover', e => this._onDragOver(e));
        el.addEventListener('contextmenu', e => this._onRightClick(e));
        el.addEventListener('touchstart', e => this._onTouchStart(e));
        el.addEventListener('touch', e => this._onTouch(e));
        el.addEventListener('touchend', e => this._onTouchEnd(e));
    }

    _displayName() {
        return this._peer.name.displayName;
    }

    _deviceName() {
        return this._peer.name.deviceName;
    }

    _deviceWallet() {
        this.device_wallet=this._peer.name.wallet

        if (  this.device_wallet == 'Message Only') {
            this._peerwallet = this.device_wallet
        } else {
            this._peerwallet = this.device_wallet.substring(0,6) + "..." + this.device_wallet.substr(this.device_wallet.length - 6);
        }
        return this._peerwallet;
    }

    _circleColor() {
        this._randomColor = this._peer.name.color
        return this._randomColor;
    }

    _icon() {
        const device = this._peer.name.device || this._peer.name;
        if (device.type === 'mobile') {
            return '#phone-iphone';
        }
        if (device.type === 'tablet') {
            return '#tablet-mac';
        }
        if (this._peer.name.deviceName === 'xApp') {
            return '#xumm-logo';
        }
        return '#desktop-mac';
    }

    _onPayClick(e) {
        e.preventDefault();
        Events.fire('pay-recipient', {id: this._peer.id, wallet: this._peer.name.wallet, alias: this._peer.name.displayName });

    }

    setProgress(progress) {
        if (progress > 0) {
            this.$el.setAttribute('transfer', '1');
        }
        if (progress > 0.5) {
            this.$progress.classList.add('over50');
        } else {
            this.$progress.classList.remove('over50');
        }
        const degrees = `rotate(${360 * progress}deg)`;
        this.$progress.style.setProperty('--progress', degrees);
        if (progress >= 1) {
            this.setProgress(0);
            this.$el.removeAttribute('transfer');
        }
    }

    _onRightClick(e) {
        e.preventDefault();
        Events.fire('text-recipient', {id: this._peer.id, alias: this._peer.name.displayName });
    }

    _onSubmit(e) {
        e.preventDefault();
        Events.fire('add-wallet');
    }

    _onTouch(e) {
        e.preventDefault();

        Events.fire('pay-recipient', {id: this._peer.id, wallet: this._peer.name.wallet, alias: this._peer.name.displayName });
    }

    _onTouchStart(e) {
        this._touchStart = Date.now();
        this._touchTimer = setTimeout(_ => this._onTouchEnd(), 610);
    }

    _onTouchEnd(e) {
        if (Date.now() - this._touchStart < 500) {
            clearTimeout(this._touchTimer);
        } else { // this was a long tap
            if (e) e.preventDefault();
            Events.fire('text-recipient', {id: this._peer.id, alias: this._peer.name.displayName });
        }
    }

    _peerData() {
        this._dataset = {
            id: this._peer.id,
            wallet: this._peer.name.wallet,
            name: this._peer.name.displayName,
            color: this._peer.name.color
        }
        return JSON.stringify(this._dataset)
    }
}

class Dialog {
    constructor(id) {
        this.$el = $(id);
        this.$el.querySelectorAll('[close]').forEach(el => el.addEventListener('click', e => this.hide()))
        this.$autoFocus = this.$el.querySelector('[autofocus]');
    }

    show() {
        this.$el.setAttribute('show', 1);
        if (this.$autoFocus) this.$autoFocus.focus();
    }

    hide() {
        this.$el.removeAttribute('show');
        document.activeElement.blur();
        window.blur();
    }
}

class SelectDialog extends Dialog {
    constructor() {
        super('selectWalletDialog');
        Events.on('selector', e => this._onOpen(e))
        Events.on('xumm-callback', e => this._openXUMM(e));
        Events.on("display-set", e => this._onDisplayName(e.detail));

        this.$xumm = this.$el.querySelector('#xumm');
        this.$manual = this.$el.querySelector('#manual');
        //this.$solo = this.$el.querySelector('#solo');
        //this.$ledger = this.$el.querySelector('#ledger');
        this.$message = this.$el.querySelector('#message');
        this.$xumm.addEventListener('click', e => this._openXUMM(e));
        this.$manual.addEventListener('click', e => this._openManual(e));
        //this.$solo.addEventListener('click', e => this._openSolo(e));
        //this.$ledger.addEventListener('click', e => this._openLedger(e));
        this.$message.addEventListener('click', e => this._openMessage(e));
        this.close = this.$el.querySelector('#back');
        this.close.addEventListener('click', e => this._onClose(e));
    }

    _onDisplayName(message) {
        this.me = message
    }

    async _onOpen(e) {
        e.preventDefault();
        this.show();
    }

    _onClose(e) {
            super.hide();
    }

    async _openXUMM(e) {
        e.preventDefault();
        sessionToggle.method = 'xumm';

        this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
        localStorage.setItem ("session", this.change);

        await xumm_init();
        const data = await xumm_payload({txjson: {"TransactionType": "SignIn"}})
        Events.fire("xumm-sign", {title:"Great choice :P",instruction:"Open XUMM and sign-in with QR Code (Testnet)", data: data, close_event: "Back", type:"SignIn"});
        super.hide()
    }

    _openManual(e) {
        e.preventDefault();
        sessionToggle.method = 'account';

        this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
        localStorage.setItem ("session", this.change);

        Events.fire("add-wallet", {from: "SelectDialog",fire: 'selector'});
        super.hide()
    }

    _openSolo(e) {
        e.preventDefault();
        sessionToggle.method = 'solo';

        this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
        localStorage.setItem ("session", this.change);

        Events.fire("solo-add", {from: "SelectDialog",fire: 'selector'});
        super.hide()
    }

    _openLedger(e) {
        e.preventDefault();
        sessionToggle.method = 'ledger';

        this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
        localStorage.setItem ("session", this.change);

        Events.fire("ledger-add", {from: "SelectDialog",fire: 'selector'});
        super.hide()
    }

    async _openMessage(e) {
        e.preventDefault();

        sessionToggle.method = 'message only';
        this.Key = "Message Only";
        me.wallet = this.Key;

        this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
        localStorage.setItem ("session", this.change);

        Events.fire("change-wallet", me.wallet);
        
        const peers = document.querySelectorAll('x-peer');

        this.room = [];

        for (let i=0; i<peers.length; i++) {
            const info = JSON.parse((peers[i]).getAttribute('data-peer'))
            this.room.push(info);
            console.log(this.room);
        }

        this.room.map(peer => {Events.fire('peer-change', {to:peer.id, from: me})})
        super.hide()
    }
}

class RoomDialog extends Dialog {
    constructor() {
        super('roomDialog');
        Events.on('room', e => this._onOpen(e));

        this.$room= this.$el.querySelector('#createRoom');
        this.$join= this.$el.querySelector('#joinRoom');

        this.$room.addEventListener('click', e => this._openCreate(e));
        this.$join.addEventListener('click', e => this._openJoin(e));
    }

    _onOpen(e) {
        e.preventDefault();
        this.show();
    }

    _onClose(e) {
            super.hide();
    }

    _roomuuid() {
        let uuid = '',
            ii;
        for (ii = 0; ii < 32; ii += 1) {
            switch (ii) {
                case 8:
                case 20:
                    uuid += '-';
                    uuid += (Math.random() * 16 | 0).toString(16);
                    break;
                case 12:
                    uuid += '-';
                    uuid += '4';
                    break;
                case 16:
                    uuid += '-';
                    uuid += (Math.random() * 4 | 8).toString(16);
                    break;
                default:
                    uuid += (Math.random() * 16 | 0).toString(16);
            }
        }
        return uuid;
    };

    async _openCreate(e) {
        e.preventDefault();

        this.roomId = await this._roomuuid();
        console.log(`This is the created roomId ${this.roomId}`)
        Events.fire('create', {type: "createRoom", title:"Great, let's begin :P",instruction:`Your port will be idenified by the string below:`,subinstruction:`Sign in with account to enable admin rights of the port`,data:this.roomId, close_event: "Back"});
        super.hide()
    }

    _openJoin(e) {
        e.preventDefault();
        Events.fire("add-room", {from: "roomDialog",fire: 'room'});
        super.hide()
    }
}

class CreatedRoomDialog extends Dialog {
    constructor() {
        super('createdRoom');
        Events.on('create', e => this._onCreate(e));

        this.$title = this.$el.querySelector('#titleText');
        this.$instruction = this.$el.querySelector('#instructionText');
        this.$roomIdContainer = this.$el.querySelector('#roomIdContainer');
        this.$subinstruction = this.$el.querySelector('#subInstruction');

        this.$signin= this.$el.querySelector('#signin');
        this.$skip= this.$el.querySelector('#skip');

        this.$signin.addEventListener('click', e => this._onSignIn(e));
        this.$skip.addEventListener('click', e => this._onSkip(e));
    }

    _onCreate(e) {

        console.log(e.detail)

        this.$title.innerText = e.detail.title;
        this.$instruction.innerText = e.detail.instruction;
        this.$roomIdContainer.innerText = e.detail.data;
        this.$subinstruction.innerText = e.detail.subinstruction;

        this.show();
    }

    _onSkip(e) {
            e.preventDefault();
    
            this.url = window.location.search
            location.href=`${this.url}\?id=${this.$roomIdContainer.innerText}`;
            
            super.hide();
    }

    async _onSignIn(e) {
        e.preventDefault();
        Events.fire('selector', {type: "createRoom", title:"Great, let's begin :P",instruction:`Your port will be idenified by the string below:`,subinstruction:`Sign in with account to enable admin rights of the port`,data:this.roomId, close_event: "Back"});
        super.hide()
    }
}

//Pushed from select dialog to add manual wallet
class AddRoomDialog extends Dialog {
    constructor() {
        super('addRoom');
        Events.on('add-room', (e) => this._onRoom(e.detail));
        this.$roomId = this.$el.querySelector('#roomInput');
        this.button = this.$el.querySelector('#add-room-button');
        this.button.addEventListener('click', (e) => this._onAdd(e));
        this.close = this.$el.querySelector('#back');
        this.close.addEventListener('click', (e) => this._onBack(e));
    }

    _onRoom(e) {
        this.show();
    }

    _onBack(e) {
        e.preventDefault();
        Events.fire(this.backfire);
    }

    async _onAdd(e) {
        e.preventDefault();

        if (this.$roomId.innerText == null) {return;}
        
        this.room = this.$roomId.innerText;
        
        this.url = window.location.search
        location.href=`${this.url}\?id=${this.room}`;
        super.hide();
    }
}  


//Pushed from either addXumm or 
class AliasDialog extends Dialog {
    constructor() {
        super('addAliasDialog');
        Events.on('alias', e => this._onOpen(e.detail))
 
        this.$alias = this.$el.querySelector('#aliasInput');

        const button = this.$el.querySelector('#skip-button');
        button.addEventListener('click', e => this._onChange(e));

        this.close = this.$el.querySelector('#back');
        this.close.addEventListener('click', e => this._onBack(e));
    }

    _onOpen(e) {
        
        this.origin = e.from;
        this.backfire = e.fire;

        if( this.origin == 'xApp' ){
            this.close.remove();
        }

        this.show();
    }

    _onBack(e) {
        e.preventDefault();
        Events.fire(this.backfire, {from:null, fire:null});
    }

    async _onChange(e) {
        e.preventDefault();

        if (this.$alias.innerText == null) {return;}
        if (this.$alias.innerText == '') {return;}

        this.Alias = this.$alias.textContent;
        me.displayName = this.Alias;

        this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
        localStorage.setItem ("session", this.change);

        Events.fire("change-alias", me.displayName);
        
        const peers = document.querySelectorAll('x-peer');

        this.room = [];
        //this.room_size = peers.length;

        for (let i=0; i<peers.length; i++) {
            const info = JSON.parse((peers[i]).getAttribute('data-peer'))
            this.room.push(info);
        };

        this.room.map(peer => {Events.fire('peer-change', {to:peer.id, from: me})})
    }
}

//Pushed from select dialog to add manual wallet
class AddWalletDialog extends Dialog {
    constructor() {
        super('addWalletDialog');
        Events.on('add-wallet', (e) => this._onWallet(e.detail));
        this.$publicKey = this.$el.querySelector('#addressInput');
        this.button = this.$el.querySelector('#add-button');
        this.button.addEventListener('click', (e) => this._onChange(e));
        this.close = this.$el.querySelector('#back');
        this.close.addEventListener('click', (e) => this._onBack(e));
    }

    _onWallet(e) {

        if( e.from == null) {
            // Nothing
        } else {
        this.origin = e.from;
        this.backfire = e.fire;
        }
        this.show();
    }

    _onBack(e) {
        e.preventDefault();
        Events.fire(this.backfire);
    }

    async _onChange(e) {
        e.preventDefault();

        if (this.$publicKey.innerText == null) {return;}
        
        this.Key = this.$publicKey.innerText;
        me.wallet = this.Key;

        this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
        localStorage.setItem ("session", this.change);

        Events.fire("change-wallet", me.wallet);
        
        const peers = document.querySelectorAll('x-peer');

        this.room = [];

        for (let i=0; i<peers.length; i++) {
            const info = JSON.parse((peers[i]).getAttribute('data-peer'))
            this.room.push(info);
        };

        this.room.map(peer => {Events.fire('peer-change', {to:peer.id, from: me})})
        super.hide();
    }
}  

//Pushed from select dialog to add xumm wallet
class AppSignDialog extends Dialog {
    constructor() {
        super('appSignDialog');
        Events.on('xumm-sign', e => this._onOpen(e.detail))
        Events.on('xumm-group-sign', e => this._onGroupOpen(e.detail))
        Events.on('solo-add', e => this._onOpen(e))
        Events.on('xumm-signed', e => this._onXUMM(e.detail))
        Events.on('back', e => this._onBack(e))

        Events.on('hide', e => this._onHide(e));

        this.$qrcode = this.$el.querySelector('#qrcode');
        this.$title = this.$el.querySelector('#titleText');
        this.$instruction = this.$el.querySelector('#instructionText');
        this.$url = this.$el.querySelector('#app');
        this.$url.addEventListener('click', e => this._onClick(e));
        this.close = this.$el.querySelector('#back');
        this.close.addEventListener('click', e => this._onClose(e));
    }

    _onClick(e) {
        e.preventDefault;
        window.open(this.url,'_blank');
    }

    async _onOpen(packet) {
        this.$title.innerText = packet.title;
        this.$instruction.innerText = packet.instruction;

        if(!packet.info) {/*do nothing*/}
        else {
            this.destination = packet.info.destination;
            this.amount = packet.info.amount;
          }

        this.closeEvent = packet.close_event
        this.type = packet.type

            this.$qrcode.src = packet.data.qrcode
            this.$qrcode.width = 200;
            this.url = packet.data.url
            this._openWebSocket(packet.data.websocket, this.type);

        this.show();
    }

    async _onGroupOpen(packet) {

        this.$displayWallet = $('displayWallet').textContent;

        this.closeEvent = packet.close_event
        this.type = packet.type

        this.resultArray=[];

        for (let i=0; i<packet.data.length; i++) {

            if(i == 0) {
                this.$title.innerText = packet.title;
            } else {
                this.$title.innerText = '"Another one..." :P';
            }

            this.id = packet.data[i].id;
            this.alias = packet.data[i].alias;
            this.destination = packet.data[i].destination;
            this.amount = packet.data[i].amount;

            this.$qrcode.src = packet.data[i].qrcode;
            this.$qrcode.width = 200;
            this.$url.href = packet.data[i].url;
            this.$instruction.innerText = packet.instruction + `\r\n\r\n Sending ${this.amount} XRP to ${this.alias } \r\n ${i+1} of ${packet.data.length}`;
            this.$instruction.style = "text-align: center";
            this.show();

            groupWebSocket(packet.data[i].websocket, this.type);
            const result = await callback();
            console.log(result);

            const hashOptions = {method: 'POST',headers: {'Content-Type': 'application/json'},body: JSON.stringify({uuid : result.uuidPayload})};

            const hash = await fetch('/get_hash', hashOptions)    
                        .then(response =>  response.json())
                        .then(res => {

                            const sending_packet = {
                                to: packet.data[i].id,
                                destination: packet.data[i].destination,
                                amount: packet.data[i].amount, 
                                from:this.$displayWallet,
                                alias:this.displayName,
                                id:res.id,
                                toAlias: packet.data[i].alias,
                            }
                            this.resultArray.push(sending_packet);
                            Events.fire("grouptx-success", sending_packet);
                            Events.fire("message-close")
                            return res.id;
                        })
                        .catch(err => console.error('error:' + err))
        }

        if( this.resultArray.length = packet.data.length) {
            Events.fire('group-pay-sent', this.resultArray)
            super.hide();
        }

    }

    _onHide(e) {
            super.hide();
    }

    _onClose(e) {

        if (this.closeEvent == "Back") {
            super.hide();
            Events.fire('backed');
            Events.fire('selector');
        } else {
            super.hide();
            Events.fire('backed');
        }
    }

    _openWebSocket(url, type) {
        const ws = new WebSocket(url);

        ws.onmessage = function(event) {
            const resp = JSON.parse(event.data);
            if(resp.signed == false) {
                Events.fire('back')
                Events.fire('message-close');
                Events.fire('message', {title: "Oops", message: "Sign rejected, try again :P"})

            } else if(resp.signed == true) {

                if (type == "SignIn") {
                    const data = {
                        type:"setXumm",
                        uuidPayload :resp.payload_uuidv4,
                        uuidCall :resp.reference_call_uuidv4,                    
                    }
                    Events.fire('message-close')
                    Events.fire('xumm-signed', data)
                    ws.close();
                } else {
                    const hashOptions = {method: 'POST',headers: {'Content-Type': 'application/json'},body: JSON.stringify({uuid : resp.payload_uuidv4})};

                    fetch('/get_hash', hashOptions)    
                        .then(response =>  response.json())
                        .then(res => {

                            Events.fire("tx-success", {id:res.id});
                            Events.fire("message-close");
                            Events.fire('hide');
                            ws.close();  

                        }).catch(err => console.error('error:' + err));
                    }

            } else if (Object.keys(resp).indexOf('opened') > -1){
                Events.fire('working', {title: "Processing...", message: "QR Code scanned, waiting for your approval :P"})
            }else {
                //wait for user to open or sign tx
            };
        }

        Events.on('backed', () => {
            return ws.close()
        })
    }


    async _onXUMM(data) {

        const xummOptions = {method: 'POST',headers: {'Content-Type': 'application/json'},body: JSON.stringify(data)};

        const xummSet = await fetch('/init', xummOptions)           
            .then(response =>  response.json())
            .then(res => {return res})
            .catch(err => console.error('error:' + err));

            Events.fire('user-token', xummSet.user);

            if(xummSet.server == "MAINNET") {
                Events.fire('message', {title: "Oops", message: "Sign rejected, try again with a wallet on the testnet :P"})
                const data = await xumm_payload({txjson: {"TransactionType": "SignIn"}})
                Events.fire("xumm-sign", {title:"Great choice :P",instruction:"Open XUMM and sign-in with QR Code (Testnet)", data: data, close_event: "Back", type:"SignIn"});
            } else {
                this.Key = xummSet.key;
                me.wallet = this.Key;

                this.change = JSON.stringify({wallet:me.wallet, alias: me.displayName, method: sessionToggle.method});
                localStorage.setItem ("session", this.change);

                Events.fire("change-wallet", me.wallet);
                
                const peers = document.querySelectorAll('x-peer');
        
                this.room = [];
                for (let i=0; i<peers.length; i++) {
                    const info = JSON.parse((peers[i]).getAttribute('data-peer'))
                    this.room.push(info);
                }
        
                this.room.map(peer => {Events.fire('peer-change', {to:peer.id, from: me})})
                super.hide()
        }
    }
}

//Pushed from user left click , or touch, on peer
class SendPayDialog extends Dialog {
    constructor() {
        super('sendPayDialog');
        Events.on('pay-recipient', e => this._onRecipient(e.detail));
        Events.on('tx-success', e => this._sending(e.detail));
        Events.on('grouptx-success', e => this._groupSending(e.detail));
        Events.on('user-token', e => {this.$usertoken = e.detail});


        this.$to = this.$el.querySelector('#to');
        this.$amount = this.$el.querySelector('#payInput');
        const button = this.$el.querySelector('#payForm');
        button.addEventListener('submit', e => this._send(e));
        }


    _onRecipient(recipient) {
        this._recipientId = recipient.id;
        this._recipientWallet = recipient.wallet;
        this._recipientAlias = recipient.alias;

        if (me.wallet == "Message Only") {
            Events.fire('message', {title: "Oops!", message: "You do not have payments enabled. \r\n\r\n Right click to send a message. \r\n Use toolbar at the top to add a wallet :P"});
        } else if( this._recipientWallet == "Message Only") {
            Events.fire('message', {title: "Oops!", message: "This user does not have payments enabled \r\n\r\n Send a message \r\n with a link to the XUMM app :P"})
        } else {

        this.$to.textContent = '';
        this.$to.textContent = `${(this._recipientAlias)}`;
        this.show();
        }
    }

    async _send(e) {
        e.preventDefault();

        this.$displayWallet = $('displayWallet').textContent
        this._amount = this.$amount.innerText.replace(/\n/g, '')

        switch (sessionToggle.method) {
            case 'account':
                prepTx(this.$displayWallet, this._recipientWallet , this._amount);
                break;
            case 'xumm':

                if (isNaN(this._amount) || this._amount < 0 ) {
                    Events.fire('message', {title: "Oops!", message: "Must input a valid number greater than zero"})
                    return;
                }

                const data = await xumm_payload({
                        txjson: {
                            "TransactionType" : 'Payment',
                            "Account" : String(this.$displayWallet),
                            "Destination" : String(this._recipientWallet ),
                            "Amount": String(this._amount*1000000)
                        },
                        "user_token": String(this.$usertoken)
                  })
                  Events.fire("xumm-sign", {title:"XUMM Sign Request :P",instruction:"Open XUMM app and signin with QR Code (TESTNET).", data: data, close_event: "close", type:"Single"});
                break;
            case 'xApp':
                xApp_payload({amount: this._amount,destination: this._recipientWallet ,account: this.$displayWallet});
                Events.fire('xApp-amount', {amount: this._amount});
                break;
            }
        //Events.fire('amount', this.$amount.innerText )
    }


    _sending(data) {

        console.log(data);

        Events.fire('send-pay', {
            to: this._recipientId,
            destination: this._recipientWallet,
            amount: this._amount,
            from: me.wallet,
            alias: me.displayName,
            id: data.id
        })

        Events.fire('pay-sent', {
            to: this._recipientId,
            destination: this._recipientWallet,
            amount: this._amount,
            from: me.wallet,
            alias:me.displayName,
            id: data.id,
            toAlias: this._recipientAlias
        })

        Events.fire('message-close');
    }

    _groupSending(data) {

        console.log(data);

        Events.fire('send-pay', {
            to: data.to,
            destination: data.destination,
            amount: data.amount,
            from: data.from,
            alias: me.displayName,
            id: data.id
        })

    }
}

//Pushed from send pay dialog if user has a manual address, and transaction needs for be signed
class SignDialog extends Dialog {
    constructor() {
        super('signDialog');
        Events.on('pay-recipient', e => this._onRecipient(e.detail));
        Events.on('tx-prepared', e => this._onPrepared(e.detail));
        Events.on('grouptx-prepared', e => this._onGroupPrepared(e.detail));

        this.$tx = this.$el.querySelector('#instructionTx');
        this.$secret = this.$el.querySelector('#secretInput');
        const button = this.$el.querySelector('#signForm');
        button.addEventListener('submit', (e) => this._send(e));
        }

    _onRecipient(recipient) {
        this._recipientId = recipient.id;
        this._recipientWallet = recipient.wallet;
        this._recipientAlias = recipient.alias;
    }

    _onPrepared(prepTx) {

        this._prepTx = prepTx;

        this.$tx.innerText = `Sending ${(prepTx.Amount/1000000)} XRP \r\n`
        this.$tx.innerText += `From : ${(prepTx.Account)} \r\n `
        this.$tx.innerText += `To : ${(prepTx.Destination )} \r\n`

        this.$tx.innerText += `Transaction cost: ${(prepTx.Fee/1000000)} XRP \r\n`
        this.$tx.innerText += `Transaction expires after ledger: ${(prepTx.LastLedgerSequence)}`

        this.show();
    }

    async _onGroupPrepared(preparedTx) {

        this.$tx.innerText ='';

        this._prepTx  = preparedTx.map(item => item.tx);
        this._prepGroupId = preparedTx.map(item => item.id);
        this._prepGroupAlias = preparedTx.map(item => item.alias);

        for ( let i = 0; i < preparedTx.length; i++ ) {
        this.$tx.innerText += `Sending ${(this._prepTx[i].Amount/1000000)} XRP to ${(this._prepGroupAlias[i] )} \r\n`
        this.$tx.innerText += `Transaction cost: ${(this._prepTx[i].Fee/1000000)} XRP \r\n`
        this.$tx.innerText += `Transaction expires after ledger: ${(this._prepTx[i].LastLedgerSequence)}\r\n\r\n`
        }

        this._groupAmount = preparedTx.map(item => (item.tx.Amount/1000000+item.tx.Fee/1000000));
        this._sum = this._groupAmount.reduce((a, b) => a + b, 0)
        this.$tx.innerText += `Total cost: ${(this._sum)}`

        this.show();
    }

    _send(e) {
        e.preventDefault();

        this._secret = this.$secret.innerText.replace(/\n/g, '')

        if ( this._prepTx.length > 1) { 
            console.log(this._prepTx, this._secret, this._prepGroupId, this._prepGroupAlias)

            groupSendTx(this._prepTx, this._secret, this._prepGroupId, this._prepGroupAlias);
            console.log("sending group payment...")
        } else {
            sendTx(this._prepTx, this._secret);            
            console.log("sending single payment...")
        }
    }

}

//Pushed if payment status determined from XummSign or Sign
class SentPayDialog extends Dialog {
    constructor() {
        super('sentPayDialog');
        Events.on('pay-sent', e => this._onPayment(e.detail))
        this.$amount = this.$el.querySelector('#payAmount');
        this.$to = this.$el.querySelector('#to');
        const info = this.$el.querySelector('#info');
        info.addEventListener('click', _ => this._onInfo());
    }

    _onPayment(e) {
        console.log("sent message", e)
        this.$amount.innerHTML = '';

        const amount = e.amount;
        const from = e.from;
        this.id = e.id;
        this.alias = e.toAlias;

        this.$to.innerHTML = '';
        this.$to.textContent = `${(this.alias)}`;


        this.$amount.textContent = amount + ' XRP to ' + this.alias;
        this.show();
        window.blop.play();
    }


    _onInfo() {
        const url =  "https://test.bithomp.com/explorer/" + this.id;
        window.open(url);
        //Extract transacton hash and open URL to XRPScan
    }
}

//Pushed if payment status determined from XummSign or Sign
class SentPayGroupDialog extends Dialog {
    constructor() {
        super('sentPayGroupDialog');
        Events.on('group-pay-sent', e => this._onGroupPayment(e.detail))
        this.$to = this.$el.querySelector('#to');
        this.$container = this.$el.querySelector('#groupContainer');
    }


    _onGroupPayment(e) {
        this.$container.innerText='';
        console.log("sent message", e)

        this._roomAlias = e.map(item => item.toAlias);
        this._amount = e.map(item => item.amount);
        this._id = e.map(item => item.id);

        this.$to.innerHTML = '';
        this.$to.textContent = `${(this._roomAlias)}`;

        for ( let i = 0; i < e.length; i++ ) {
            
            this.infoContainer = document.createElement('div');
            this.infoContainer.setAttribute("class", "row-reverse");
            this.infoContainer.setAttribute("style", "align-content:center");

            this.infoDiv = document.createElement('div');
            this.infoDiv.setAttribute("class", "font-subheading")
            this.infoDiv.setAttribute("style", "width:600px");
            this.infoDiv.textContent = `Sent ${(this._amount[i])} XRP to ${(this._roomAlias[i] )} \r\n`

            this.hashButton = document.createElement('button');
            this.hashButton.setAttribute("class", "button")
            this.hashButton.setAttribute("style", "margin-top:0px");
            this.hashButton.textContent = "More Info"
            this.hashButton.addEventListener('click', () => {
                    const url =  "https://test.bithomp.com/explorer/" + this._id[i];
                    window.open(url);
                })

            this.infoContainer.appendChild(this.hashButton);
            this.infoContainer.appendChild(this.infoDiv);
            this.$container.appendChild(this.infoContainer);
            
        }

        this.show();
        window.blop.play();
    }

}

//Pushed if receive payment from XummSign or Sign
class ReceivePayDialog extends Dialog {
    constructor() {
        super('receivePayDialog');
        Events.on('pay-received', e => this._onPayment(e.detail))
        this.$amount = this.$el.querySelector('#payAmount');
        this.$from = this.$el.querySelector('#from');
        const info = this.$el.querySelector('#info');
        info.addEventListener('click', _ => this._onInfo());
    }

    _onPayment(e) {
        console.log("sent message", e)
        this.$amount.innerHTML = '';
        const amount = e.message.amount;
        const destination = e.message.destination;
        const from = e.message.from;
        const to = e.message.to;
        this.id = e.message.id;
        this.alias = e.message.alias;


        this.$from.innerHTML = '';
        this.$from.textContent = `${(this.alias)}`;

        /*if (isURL(amount)) {
            const $a = document.createElement('a');
            $a.href = amount;
            $a.target = '_blank';
            $a.textContent = amount;
            this.$amount.appendChild($a);
        } else {
            //Do nothing...;
        }*/
        this.$amount.textContent = `${(amount)} XRP from ${(this.alias)}`;
        this.show();
        window.blop.play();
    }

    _onInfo() {
        const url =  "https://test.bithomp.com/explorer/" + this.id;
        window.open(url);
        //Extract transacton hash and open URL to XRPScan
    }
}

//Pushed from user right click , or long press, on peer
class SendTextDialog extends Dialog {
    constructor() {
        super('sendTextDialog');
        Events.on('text-recipient', e => this._onRecipient(e.detail))

        this.$to = this.$el.querySelector('#to');
        this.$text = this.$el.querySelector('#textInput');
        const button = this.$el.querySelector('form');
        button.addEventListener('submit', e => this._send(e));
    }

    _onRecipient(recipient) {

        this._recipientId = recipient.id;
        this._recipientAlias = recipient.alias;
        this._handleShareTargetText();

        this.$to.innerHTML = '';
        this.$to.textContent = `${(this._recipientAlias)}`;


        this.show();

        const range = document.createRange();
        const sel = window.getSelection();

        range.selectNodeContents(this.$text);
        sel.removeAllRanges();
        sel.addRange(range);

    }

    _handleShareTargetText() {
        if (!window.shareTargetText) return;
        this.$text.textContent = window.shareTargetText;
        window.shareTargetText = '';
    }

    _send(e) {
        e.preventDefault();

        Events.fire('send-text', {
            to: this._recipientId,
            from: me.displayName,
            text: this.$text.innerText
        });
    }
}

class ReceiveTextDialog extends Dialog {
    constructor() {
        super('receiveTextDialog');
        Events.on('text-received', e => this._onText(e.detail))
        this.$text = this.$el.querySelector('#text');
        this.$from = this.$el.querySelector('#from');
        const $copy = this.$el.querySelector('#copy');
        copy.addEventListener('click', _ => this._onCopy());
    }

    _onText(e) {

        this.$from.innerHTML = '';
        const from = e.message.from;
        this.$from.textContent = `${(from)}`;

        this.$text.innerHTML = '';
        const text = e.message.text;
        this.$text.textContent = text;

        this.$text.textContent = text;
        this.show();
        window.blop.play();
    }

    async _onCopy() {
        await navigator.clipboard.writeText(this.$text.textContent);
        Events.fire('notify-user', 'Copied to clipboard');
    }
}

//Pushed from user right click , or long press, on user
class SendGroupTextDialog extends Dialog {
    constructor() {
        super('sendGroupTextDialog');
        Events.on('text-group', e => this._onRecipient(e.detail));

        this.$to = this.$el.querySelector('#to');
        this.$text = this.$el.querySelector('#textInput');
        const button = this.$el.querySelector('form');
        button.addEventListener('submit', e => this._send(e));
    }

    _onRecipient(room) {
        const roomId_array=[]
        const roomWallet_array=[]
        const roomAlias_array=[];

            for (let i=0; i < room.length; i++) {
                
                roomId_array.push(room[i].id)
                roomWallet_array.push(room[i].wallet)
                roomAlias_array.push(room[i].name)
            }

        this._roomId = roomId_array;
        this._roomWallet = roomWallet_array;
        this._roomAlias = roomAlias_array;

        this.$to.innerHTML = '';
        this.$to.textContent = `${(this._roomAlias)}`;

        this._handleShareTargetText();
        this.show();

        const range = document.createRange();
        const sel = window.getSelection();

        range.selectNodeContents(this.$text);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    _handleShareTargetText() {
        if (!window.shareTargetText) return;
        this.$text.textContent = window.shareTargetText;
        window.shareTargetText = '';
    }

    _send(e) {
        e.preventDefault();

        for (let i=0; i < this._roomId.length; i++) {
            this._id = this._roomId[i];

        Events.fire('send-text', {
            to: this._id,
            from: me.$displayName,
            text: this.$text.innerText
            })
        }
    }
}

//Pushed from user left click , or touch, on peer
class SendGroupPayDialog extends Dialog {
    constructor() {
        super('sendGroupPayDialog');
        Events.on('pay-group', e => this._onRecipient(e.detail))
        this.$to = this.$el.querySelector('#to');
        this.$amount = this.$el.querySelector('#payInput');
        Events.on('user-token', e => {this.$usertoken = e.detail});
        const button = this.$el.querySelector('#payGroupForm');
        button.addEventListener('submit', e => this._send(e));
        }

        _onRecipient(room) {

            const roomId_array=[]
            const roomWallet_array=[]
            const roomAlias_array=[];

                for (let i=0; i < room.length; i++) {

                    if (room[i].wallet != "Message Only") {
                    roomId_array.push(room[i].id)
                    roomWallet_array.push(room[i].wallet)
                    roomAlias_array.push(room[i].name)
                    }
                }

            this._roomId = roomId_array;
            this._roomWallet = roomWallet_array;
            this._roomAlias = roomAlias_array;
    
            this.$to.innerHTML = '';
            this.$to.textContent = `${(this._roomAlias)}`;

            this.show();
        }


    async _send(e) {
        e.preventDefault();

        this.$displayWallet = $('displayWallet').textContent

        this._amount = this.$amount.innerText.replace(/\n/g, '')

        switch (sessionToggle.method) {
            case 'account':
                groupPrepTx(this.$displayWallet, this._roomWallet, this._amount, this._roomId, this._roomAlias );
                break;
            case 'xumm':
                const payload_array = []
                for ( let i=0; i<this._roomAlias.length; i++ ) {
                    
                    const payload = {
                        txjson: {
                            "TransactionType" : 'Payment',
                            "Account" : String(this.$displayWallet),
                            "Destination" : String(this._roomWallet[i]),
                            "Amount": String(this._amount*1000000)
                            },
                            "user_token": String(this.$usertoken)
                        }
                        
                    payload_array.push(payload)
                }

                const data = await xummGroupPayload(payload_array,this._roomId, this._roomAlias, this._roomWallet,this._amount)
                Events.fire("xumm-group-sign", {title:"XUMM Sign Request :P",instruction:"Open XUMM app and sign with QR Code (TESTNET).", data: data, id: this._roomId, alias: this._roomAlias, close_event: "next", type:"Group"});
                break;

            case 'xApp':
                xApp_groupPayload({amount: this._amount,destination: this._roomWallet , account: this.$displayWallet, id: this._roomId, alias: this._roomAlias});
                Events.fire('xApp-amount', {amount: this._amount});
                break;
            }
    }
}

class QRDialog extends Dialog {
    constructor() {
        super('qrDialog');
        Events.on('share', () => this._onShare());
        this.qr = this.$el.querySelector('#qrContainer');

        this.button = this.$el.querySelector('#dismissButton');
        this.button.addEventListener('click', e => this._onClose(e));;
        }

    _onShare() {
        this.path = window.location.search
        this.protocol = location.protocol;
        this.url = this.protocol + '//' + location.host + "/" + this.path;
        this.qrcode = document.createElement('canvas')
        console.log(this.url);

        QRCode.toCanvas(this.qrcode, this.url, { errorCorrectionLevel: 'H' }, function (error) {
            if (error) console.error(error)
            console.log('success!');
          })

        this.qrcode.style = "width: 90%"
        this.qr.appendChild(this.qrcode);
        this.show();
    }

    _onClose(e) {
        e.preventDefault();
        this.qr.innerHTML = '';
        super.hide();
    }
}



class GeneralDialog extends Dialog {
    constructor() {
        super('generalDialog');
        Events.on('message', e => this._onMessage(e.detail))
        Events.on('working', e => this._onWorking(e.detail))
        Events.on('message-close', e => this._onHide(e))
        this.$title = this.$el.querySelector('#title');
        this.$container = this.$el.querySelector('#animeContainer');
        this.$message = this.$el.querySelector('#message');
        this.button = this.$el.querySelector('#dismissButton');
        this.button.addEventListener('click', e => this._onClose(e));;
        }

    _onMessage(detail) {
        this.$title.innerText = detail.title;
        this.$message.innerText = detail.message;
        this.$container.textContent='';

        this.button.removeAttribute('disabled');
        this.button.innerText="Dismiss";

        this.show();
    }

    _onWorking(detail) {
        this.$title.innerText = detail.title;
        this.$message.innerText = detail.message;

        var wrapper = document.createElement("div");
        var animation = document.createElement("div");
        var lines = document.createElement("img");

        wrapper.setAttribute("id", "wrapper")
        animation.setAttribute("id", "animation")
        lines.setAttribute("id", "lines")
        lines.setAttribute("src", "./images/lines_alt2.svg")

        this.$container.appendChild(wrapper);
        wrapper.appendChild(animation);
        animation.appendChild(lines)

        this.button.setAttribute('disabled', true);

        this.button.innerText="";

        this.show();
    }

    _onClose(e) {
        e.preventDefault();
        this.$container.textContent='';
    }

    _onHide(e) {
        e.preventDefault();
        super.hide();
        this.$container.textContent='';
    }
}

class Toast extends Dialog {
    constructor() {
        super('toast');
        Events.on('notify-user', e => this._onNotfiy(e.detail));
    }

    _onNotfiy(message) {
        this.$el.textContent = message;
        this.show();
        setTimeout(_ => this.hide(), 3000);
    }
}

class ToastDisclaimer extends Dialog {
    constructor() {
        super('disclaimer-toast');
        Events.on('notify-disclaimer', e => this._onNotfiy());
        this.$el.addEventListener('click', _ => this._onClick());
    }

    _onNotfiy() {
        this.$el.innerHTML = 'Disclaimer: This webapp is in the early stages of development. Use at your own risk. This is built on the XRP Ledger testnet! Please do not use real money or a wallet address from the mainnet.' + "<br />" + '[click to dismiss]'
        this.show();
    }

    _onClick() {
        this.hide();
    }
}

class Notifications {

    constructor() {
        // Check if the browser supports notifications
        if (!('Notification' in window)) return;

        // Check whether notification permissions have already been granted
        if (Notification.permission !== 'granted') {
            this.$button = $('notification');
            this.$button.removeAttribute('hidden');
            this.$button.addEventListener('click', e => this._requestPermission());
        }
        Events.on('text-received', e => this._messageNotification(e.detail.text));
        Events.on('pay-received', e => this._messageNotification(e.detail.amount));
        Events.on('file-received', e => this._downloadNotification(e.detail.name));
    }

    _requestPermission() {
        Notification.requestPermission(permission => {
            if (permission !== 'granted') {
                Events.fire('notify-user', Notifications.PERMISSION_ERROR || 'Error');
                return;
            }
            this._notify('Even more rippling!');
            this.$button.setAttribute('hidden', 1);
        });
    }

    _notify(message, body, closeTimeout = 20000) {
        const config = {
            body: body,
            icon: '/images/logo_transparent_128x128.png',
        }
        let notification;
        try {
            notification = new Notification(message, config);
        } catch (e) {
            // Android doesn't support "new Notification" if service worker is installed
            if (!serviceWorker || !serviceWorker.showNotification) return;
            notification = serviceWorker.showNotification(message, config);
        }

        // Notification is persistent on Android. We have to close it manually
        if (closeTimeout) {
            setTimeout(_ => notification.close(), closeTimeout);
        }

        return notification;
    }

    _messageNotification(message) {
        if (isURL(message)) {
            const notification = this._notify(message, 'Click to open link');
            this._bind(notification, e => window.open(message, '_blank', null, true));
        } else {
            const notification = this._notify(message, 'Click to copy text');
            this._bind(notification, e => this._copyText(message, notification));
        }
    }

    _downloadNotification(message) {
        const notification = this._notify(message, 'Click to download');
        if (!window.isDownloadSupported) return;
        this._bind(notification, e => this._download(notification));
    }

    _download(notification) {
        document.querySelector('x-dialog [download]').click();
        notification.close();
    }

    _copyText(message, notification) {
        notification.close();
        if (!navigator.clipboard.writeText(message)) return;
        this._notify('Copied text to clipboard');
    }

    _bind(notification, handler) {
        if (notification.then) {
            notification.then(e => serviceWorker.getNotifications().then(notifications => {
                serviceWorker.addEventListener('notificationclick', handler);
            }));
        } else {
            notification.onclick = handler;
        }
    }
}

class NetworkStatusUI {

    constructor() {
        window.addEventListener('offline', e => this._showOfflineMessage(), false);
        window.addEventListener('online', e => this._showOnlineMessage(), false);
        if (!navigator.onLine) this._showOfflineMessage();
    }

    _showOfflineMessage() {
        Events.fire('notify-user', 'You are offline');
    }

    _showOnlineMessage() {
        Events.fire('notify-user', 'You are back online');
    }
}

class WebShareTargetUI {
    constructor() {
        const parsedUrl = new URL(window.location);
        const title = parsedUrl.searchParams.get('title');
        const text = parsedUrl.searchParams.get('text');
        const url = parsedUrl.searchParams.get('url');

        let shareTargetText = title ? title : '';
        shareTargetText += text ? shareTargetText ? ' ' + text : text : '';

        if(url) shareTargetText = url; // We share only the Link - no text. Because link-only text becomes clickable.

        if (!shareTargetText) return;
        window.shareTargetText = shareTargetText;
        history.pushState({}, 'URL Rewrite', '/');
        console.log('Shared Target Text:', '"' + shareTargetText + '"');
    }
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(serviceWorker => {
            console.log('Service Worker registered');
            window.serviceWorker = serviceWorker
        });
}

window.addEventListener('beforeinstallprompt', e => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
        // don't display install banner when installed
        return e.preventDefault();
    } else {
        const btn = document.querySelector('install')
        btn.hidden = false;
        btn.onclick = _ => e.prompt();
        return e.preventDefault();
    }
});

class About {

        about_html() {
            return `
            <section class="center column-alt fade-in-alt">
                <header class="row-reverse">
                    <a id="info-button" class="close icon-button">
                        <svg class="icon">
                            <use xlink:href="#close"/>
                        </svg>
                    </a>
                </header>
                    <div>
                        <svg width="350" version="1.1" viewBox="0 0 3921.4 970.52" xmlns="http://www.w3.org/2000/svg">
                            <g transform="translate(1791.4 341.65)" stroke-linejoin="round">
                            <g transform="matrix(.64242 0 0 .64242 -17193 -38611)" stroke-linecap="round" stroke-width="30">
                            <path d="m24076 60686c-28.585-49.961-63.913-144.71-76.196-204.35-16.428-79.777-17.073-77.999 28.286-77.999 38.276 0 86.253 7.144 132.59 19.743 22.655 6.162 24.451 8.837 38.837 57.851 8.296 28.266 16.647 55.904 18.558 61.423 2.027 5.856-10.447 27.38-29.951 51.682-18.384 22.907-44.594 60.751-58.245 84.097-13.651 23.35-26.835 42.508-29.296 42.577-2.462 0.07-13.525-15.69-24.585-35.02z" fill="#dfab7f" stroke="#dfab7f" style="paint-order:markers fill stroke"/>
                            <path d="m24142 60258c-12.733-3.153-52.173-7.76-87.644-10.239-76.003-5.313-73.178 0.347-48.471-97.049 27.696-109.18 88.402-227.01 157.25-305.22l22.914-26.029 38.374 15.573c21.106 8.567 60.555 30.057 87.665 47.752l49.29 32.179-39.821 42.566c-67.579 72.244-116.56 168.66-134.13 264-4.413 23.955-11.231 43.249-15.149 42.876-3.919-0.374-17.543-3.257-30.276-6.409z" fill="#e38b8e" stroke="#e38b8e" style="paint-order:markers fill stroke"/>
                            <path d="m25270 60301c-7.398-105.24-38.975-201.2-91.675-278.6l-23.279-34.187 37.558-16.854c20.657-9.271 61.859-23.36 91.56-31.311 43.349-11.602 55.943-12.843 63.836-6.292 16.711 13.87 68.282 126.4 86.015 187.69 9.268 32.036 20.325 85.326 24.569 118.42 7.111 55.446 6.784 60.86-4.157 68.861-15.747 11.512-103.85 40.076-146.31 47.437l-33.825 5.863z" fill="#e38b8e" stroke="#e38b8e" style="paint-order:markers fill stroke"/>
                            <path d="m25065 60921c-21.289-17.549-51.803-47.683-67.81-66.958l-29.103-35.044 41.357-23.992c22.746-13.195 66.454-48.567 97.13-78.603 54.083-52.956 56.165-54.258 68.717-42.994 17.504 15.705 58.572 76.763 79.605 118.35l17.184 33.978-37.765 35.827c-47.692 45.244-108.85 91.351-121.17 91.351-5.192 0-26.858-14.362-48.147-31.915z" fill="#61bebf" stroke="#6bbebd" style="paint-order:markers fill stroke"/>
                            <path d="m24724 60970v-96.911h32.532c17.893 0 36.86-1.662 42.15-3.691 6.293-2.416 18.397 8.448 35.012 31.419 13.966 19.312 46.033 56.618 71.259 82.904 30.953 32.256 42.865 48.827 36.636 50.967-39.842 13.7-98.67 24.463-153.1 28.014l-64.492 4.207z" fill="#e37a67" stroke="#e37a67" style="paint-order:markers fill stroke"/>
                            <path d="m24516 61038c-25.074-6.892-67.862-22.823-95.084-35.401l-49.496-22.868 41.713-27.856c22.942-15.319 60.156-45.108 82.698-66.193 44.297-41.439 58.688-46.641 64.887-23.458 7.504 28.064 11.601 133.94 6.236 161.13l-5.365 27.183z" fill="#fa876a" stroke="#fa876a" style="paint-order:markers fill stroke"/>
                            <path d="m24218 60867c-4.617-7.469 56.275-129.21 77.947-155.83l15.967-19.619 80.192 72.308-24.405 22.087c-28.051 25.384-125.7 87.054-137.84 87.054-4.485 0-9.823-2.699-11.861-5.999z" fill="#61bebf" stroke="#61bebf" style="paint-order:markers fill stroke"/>
                            <path d="m25350 60642c-13.947-21.892-41.78-57.542-61.852-79.219-40.137-43.354-40.285-43.011 21.066-48.681 21.828-2.016 61.267-9.368 87.643-16.338 38.054-10.054 47.956-10.85 47.956-3.847 0 15.119-32.639 110.19-51.484 149.96l-17.97 37.928z" fill="#90889a" stroke="#90889a" style="paint-order:markers fill stroke"/>
                            <path d="m24969 59841c-86.718-44.622-129.83-54.673-236.09-55.041l-87.265-0.304 3.404-29.766c5.154-45.069 14.715-92.133 26.41-130 12.73-41.222 17.944-42.903 108.59-35.031 155.87 13.541 293.39 69.276 411.51 166.78 17.281 14.266 31.419 28.093 31.419 30.728s-17.115 10.121-38.034 16.635c-20.918 6.511-63.495 24.915-94.614 40.894-31.12 15.98-57.909 28.691-59.532 28.246-1.622-0.444-31.227-15.359-65.788-33.144z" fill="#f79895" stroke="#f79895" style="paint-order:markers fill stroke"/>
                            <path d="m24444 59782c-21.339-17.658-58.048-42.267-81.575-54.687l-42.778-22.582 53.196-27.676c46.102-23.984 139.72-63.28 139.72-58.644 0 0.875-4.465 24.926-9.922 53.44-5.456 28.514-9.92 72.419-9.92 97.565s-2.233 45.487-4.961 45.204c-2.729-0.283-22.42-14.962-43.759-32.62z" fill="#6bbebd" stroke="#6bbebd" style="paint-order:markers fill stroke"/>
                            </g>
                            <g transform="translate(25368 -39340)" fill="#fff" stroke="#fff" stroke-width="34.664" aria-label="INTERPORT">
                            <path d="m-25779 39624q0 5.458-3.752 9.892t-6.481 8.527q-4.775 2.388-9.209 2.729-4.093 0.682-8.869 2.388-1.705 0.341-3.752 2.387-2.728-0.341-5.457-2.387-2.729-1.706-5.458-2.388-3.752-1.364-9.891-1.705-5.799-0.342-8.528-3.411-4.775-4.776-8.186-12.621-3.07-7.845-5.116-16.713-1.706-8.869-2.729-17.396-0.682-8.868-0.682-15.349 0-10.915 1.364-21.83 1.365-10.915 4.093-21.148v-1.705q0-1.706 0-2.729 0.342-1.364 0.342-3.07 0-1.023-0.342-2.046 0-1.023-1.023-1.706 4.434-11.256 6.481-23.194 2.046-11.938 3.07-23.876 1.364-12.28 2.728-24.218 1.706-12.279 4.776-23.876-0.341-2.047-0.682-4.434 0-2.388 0-4.435 0-6.139 1.364-11.938 1.364-6.14 1.705-12.62 0.341-2.047 0-4.093-0.341-2.388-0.341-4.776 0-15.008 1.365-29.334 1.705-14.325 1.705-28.992 0-7.845-1.364-15.008-1.024-7.504-1.024-15.008 0-3.411 0.342-6.481 0.341-3.411 2.046-6.14 7.504-5.116 17.737-5.116 7.504 0 12.961 4.093-0.341 0.682-0.341 2.046 0 1.706 0.341 3.07 0.341 1.365 0.341 3.07v1.364q0 0.683-0.341 1.365 2.388 4.093 3.07 8.868 1.023 4.434 1.023 9.21 0 4.434-0.341 8.868-0.341 4.093-0.341 8.527 0 6.14 0 12.28 0.341 6.139 0.341 12.279 0 16.372-1.705 32.404-1.364 15.69-2.047 32.062-0.682 13.985-3.752 27.288-2.728 13.302-3.752 26.946-0.341 2.729-0.341 5.457 0.341 2.388 0.341 5.458 0 7.845-3.069 15.69-3.07 7.504-3.07 16.031 0 4.093 1.364 7.163-2.046 5.458-3.752 12.962-1.364 7.504-2.729 15.69-1.023 7.845-1.705 15.69-0.682 7.504-0.682 13.303 0 8.186 2.046 16.713 2.047 8.187 6.822 15.008 3.411 1.024 8.186 1.024 4.776 0 9.551 0.341t8.868 1.705q4.093 1.365 6.14 5.458 0.341 0.682 0.341 1.364z"/>
                            <path d="m-25449 39292q-2.047 3.411-3.07 7.163-0.682 3.752-1.023 7.504h-2.388q-2.729 0-4.775-0.682-2.047-1.024-4.775-1.706 1.364 12.962 1.705 26.264 0.341 13.303 0.341 26.264 0 16.373-0.341 32.745-0.341 16.031-0.341 32.404 0 7.845-1.023 15.69-0.683 7.504-4.093 14.667 0.682 5.799 1.023 11.256 0.341 5.116 0.341 10.915 0 16.031-2.047 32.063-1.705 15.69-4.434 31.38-1.023 6.14-2.046 12.62-0.683 6.14-2.388 11.939-0.682 1.705-2.047 3.411-1.023 1.705-1.705 3.41-4.093 8.869-9.21 17.737-4.775 8.528-11.597 15.69-5.116 0.342-9.891 2.729-4.776 2.388-8.869 2.388-3.752 0-6.139-3.752l-3.411 1.364q-1.706 0.682-3.752 1.023-11.597-4.775-22.171-11.597-10.233-6.822-17.055-17.736h-1.364q-3.07 0-4.434-1.365-1.706-1.705-3.752-4.093-1.706-2.729-3.07-4.775-4.093-6.481-8.869-12.962-4.775-6.48-11.256-10.915-2.728-10.232-8.186-17.395-5.457-7.504-11.256-16.032-4.434-17.054-16.372-31.721 1.705-1.706 1.705-2.388 0-1.705-1.364-2.729-1.023-1.364-1.023-2.728 0-1.365 0.682-2.047-4.434-4.775-7.504-10.574-2.729-6.139-5.458-12.279-2.387-6.14-5.457-12.279-2.729-6.14-6.822-11.256-3.752 2.387-4.775 5.798-0.683 3.411-0.683 7.163 0 2.729 0 5.458 0.342 2.728 0.342 5.457 0 6.822-1.706 13.303-1.364 6.48-2.046 13.302-0.342 4.776-0.342 10.574 0.342 5.799-0.341 11.597-0.341 5.799-1.705 11.256-1.364 5.458-4.775 9.21-2.047 19.442-5.117 38.884t-5.798 38.885q-0.683 3.411-1.365 8.527t-1.705 10.233q-0.682 5.457-1.365 10.232-0.341 5.117-0.341 8.187 0 3.411 1.706 6.48 1.705 3.411 1.705 6.481 0 2.388-1.705 2.729-1.365 0.682-1.706 2.729 2.388 7.504 2.388 17.054 0 2.729-0.341 5.458-0.341 3.07-1.023 5.798-0.683 1.706-2.388 3.07-1.705 1.706-1.705 3.07t1.364 2.046q-2.047 2.047-5.116 2.729-3.07 0.682-4.435 3.752-3.411-2.729-6.822-5.116-3.41-2.047-6.48-4.775l-1.024-0.342q-2.387 0-4.093 1.365-1.364 1.705-3.752 1.705-0.682 0-1.364-0.341-0.341 0-1.023 0l-2.047-8.868q-1.023-4.434-2.729-8.186 2.729-7.163 3.411-16.373 1.024-8.868 2.047-18.078 1.023-9.209 3.07-17.736 2.046-8.187 7.504-14.326 0-2.729-2.047-3.752-1.705-1.024-1.705-4.435 0-0.682 0.341-2.387 0.682-1.706 1.023-3.752 0.682-2.047 1.023-3.752 0.683-2.047 1.024-3.07 2.728-13.303 4.093-27.287 1.705-13.985 8.527-25.923-0.341-1.365-0.341-4.093 0-5.799 1.023-11.256 1.365-5.458 1.365-11.256 0-4.776-1.024-8.869 1.024-3.752 2.729-7.163 2.047-3.752 2.047-7.504 0-3.411-2.388-4.775 1.705-1.364 2.047-3.07 0.682-1.705 0.682-3.411 0.341-1.705 0.682-3.07 0.682-1.705 2.729-2.728-0.341-3.411-0.683-6.481 0-3.07 0-6.481 0-12.62 1.365-24.9 1.364-12.62 1.364-25.581 0-12.621-2.046-24.559l3.752-7.504q-3.411-2.729-4.435-8.868-1.023-6.14-1.364-13.303t-1.364-13.985q-0.682-7.163-3.752-11.597v-3.07q0-5.457-0.682-10.574-0.683-5.116-0.683-10.232v-3.07q1.706-0.682 2.388-2.388 1.023-1.705 1.364-3.411h1.365q4.093 0 8.186-0.682t8.186-0.682h4.434q4.093 3.07 7.163 7.163t7.504 7.504v6.139q3.07 4.094 4.776 8.869 1.705 4.775 3.41 9.892 2.047 5.116 4.094 9.891 2.046 4.775 5.798 8.186-0.682 3.411-0.682 5.458 0 4.434 0.682 8.868 1.023 4.434 1.364 8.528 1.365 1.705 2.388 4.434 1.023 2.387 3.411 3.07 1.706 13.302 6.822 25.24 5.457 11.939 7.845 24.9 2.729 2.729 4.093 6.822 1.364 3.752 2.729 7.504 1.705 3.752 3.411 7.163 2.046 3.07 5.798 4.434 2.047 8.186 5.117 16.372 3.07 8.187 9.55 13.985 0 6.822 2.047 11.938 2.387 4.776 5.116 9.21 3.07 4.093 5.458 8.186 2.387 4.093 3.069 8.868 4.776 7.163 10.915 13.303 6.481 6.14 12.962 11.938 6.822 5.458 13.302 11.256 6.481 5.799 11.939 12.28 3.752 0.341 6.139 1.705 2.729 1.023 6.14 1.706 2.388-1.706 3.752-4.094 1.705-2.728 3.07-5.457 1.364-2.729 2.729-5.116 1.705-2.729 4.093-4.776 0-0.682-0.341-1.023 0-0.682 0-1.364 0-3.752 1.023-5.799 1.364-2.388 3.07-5.116v-8.869q2.728-5.116 3.752-10.915 1.023-5.798 1.023-11.597 0-4.775-0.341-9.55-0.341-5.117-0.341-10.233 0-3.07 0.341-6.14 0.341-3.411 1.364-6.139 0.682-0.683 2.388-2.047 1.705-1.705 1.705-2.046 0-1.706-1.023-3.411-1.023-1.706-1.023-3.411 0-2.388 2.046-3.752v-2.047q0-1.705-0.682-3.07-0.341-1.705-2.046-2.387 1.705-2.047 2.387-4.776 0.682-3.069 0.682-6.139 0.342-3.411 0-6.481 0-3.07 0-5.799 0-3.069 0.342-6.48 0.341-3.411 2.728-5.799-1.023-4.093-1.364-7.845-0.341-4.093-0.341-8.186 0-7.163 0.682-14.326t0.682-14.667q0-2.729-0.341-5.457-0.341-3.07-0.341-5.799t1.023-2.388q1.365 0 1.365-1.705 0-2.388-0.683-4.775-0.341-2.388-0.682-4.776-0.682-5.798-1.023-11.597-0.341-6.139-0.341-12.279 0-3.752 0-7.504 0.341-4.093 1.364-7.845-2.046-3.07-2.728-5.799-0.342-3.07-0.683-5.457l-0.682-5.117q-0.341-2.728-2.046-5.457-0.341-0.341-0.341-2.047 0-2.728 1.364-4.093-1.706-5.798-4.775-11.256-2.729-5.457-3.411-11.938-3.752-2.047-5.799-6.481-1.705-4.775-1.705-8.527 0-4.434 2.387-8.527 2.388-4.435 7.504-4.435 2.047 0 3.752 1.365 2.047 1.023 3.752 2.729 2.047 1.364 3.752 2.728 2.047 1.024 4.093 1.024 1.365 0 4.094-0.683 3.752 5.117 7.504 9.551 4.093 4.093 8.186 8.527 0 5.799 2.046 10.574 2.047 4.775 4.435 9.21 2.387 4.093 4.093 8.186 2.046 4.093 1.705 8.868 0.682 2.388 2.729 3.411 2.046 1.023 3.752 2.729z"/>
                            <path d="m-25092 39282q-2.729 1.706-5.799 2.047-3.069 0.341-6.48 1.023-3.07 0.341-5.799 1.364-2.729 1.024-4.093 3.752-3.411-3.41-7.504-5.798t-8.186-5.117q-3.411 1.024-6.822 2.729-3.411 1.706-6.822 1.706-2.388 0-4.775-1.706-2.729 2.047-6.481 3.411-3.411 1.023-7.504 2.047-3.752 1.023-7.163 2.728-3.07 1.706-4.434 5.117-0.682-1.706-3.411-1.023-2.388 0.682-2.729-1.706-10.915 3.752-22.171 6.481t-22.512 5.798q-11.256 3.07-22.171 6.822t-21.147 9.21q-0.341 0.341-0.341 1.023 0 3.411 1.023 6.481t1.705 5.798q-6.139 20.807-8.186 42.296-2.047 21.488-5.457 42.295v1.364q0 1.706 1.364 2.729 1.364 0.682 1.364 2.729l-0.341 0.682q-1.705 1.023-2.387 3.07-0.683 1.705-0.683 3.752 0 1.364 0.683 4.093-5.799 19.442-7.846 39.567-1.705 20.124-4.434 40.248l-3.07 22.513q-0.682 2.046-1.364 4.093-0.341 1.705-0.341 3.752 0 10.915 1.364 21.488 1.706 10.233 1.024 21.148 3.069 4.775 3.069 9.21 0 1.705-0.341 3.411 0 1.705-0.341 3.41 4.434 4.435 10.233 6.14 6.14 2.047 10.915 6.14v1.364q0 3.411-1.023 6.481-1.024 3.411-1.706 6.822-0.682 2.728-1.705 7.845-0.682 5.116-2.047 6.822-1.705 2.387-5.116 4.093-3.07 2.046-6.14 2.046-1.023 0-3.07-1.023-1.705-1.023-2.728-1.705-1.706 0-4.435 1.705-2.728 1.705-5.457 1.705-1.364 0-2.388-0.341-1.023 0-2.387-0.682-1.365-3.411-4.093-6.139-2.388-2.388-5.799-4.776 0.341-4.775-1.705-7.163-2.047-2.387-4.094-6.139-0.682-4.776-1.364-10.915-0.341-6.14-5.116-8.869 1.705-2.387 1.705-6.48 0-1.706-0.682-3.752-0.341-2.047-2.047-3.07v-0.682q-0.341-1.706 1.024-2.388 1.705-1.023 1.705-2.729v-1.364q-2.387-10.915-2.387-22.853 0-11.256 0.682-22.171 0.682-11.256 0-22.512 2.046-1.706 3.07-5.458 1.364-3.752 2.046-8.186t0.682-8.527q0.341-4.434 0.682-7.163 1.706-19.442 5.458-38.203 3.752-19.101 4.434-38.884 1.706-2.729 2.047-7.163t0.341-9.209q0-5.117 0.682-9.892t2.729-8.186q0-9.551 1.705-19.101 1.706-9.892 1.706-19.784 0-4.775-1.024-9.891-3.411-1.365-6.139-1.365-3.752 0-7.845 1.706-3.752 1.364-5.458 4.434-7.504 0.341-14.667 2.388-7.163 2.046-14.326 2.046h-3.411q-1.364 0-3.069-0.341-2.388 1.023-5.117 1.705-2.387 0.683-2.046 4.094-10.574 1.023-20.807 4.434-9.892 3.411-19.783 7.504-9.892 3.752-19.784 7.163-10.232 3.411-20.806 4.434-3.752 1.705-4.776 7.163-7.504-0.682-12.62-3.752t-11.938-5.799q-2.047-7.163-2.047-13.643 0-8.528 3.411-16.373t10.915-11.597q1.706 0.341 3.07 0.682 1.364 0 3.07 0 5.457 0 10.915-2.046 5.457-2.047 11.256-2.047 1.705 0 3.752 1.023 2.387-1.364 6.139-2.046 3.411-1.023 6.481-1.706 3.411-1.023 6.14-2.728 2.729-1.706 3.411-4.776 1.705 1.365 3.752 1.706 2.046 0.341 4.093 0.341 4.434 0 9.209-1.706 4.776-1.705 7.504-5.457 2.388 2.729 6.822 2.729 4.775 0 9.21-2.388 4.775-2.729 9.209-2.729 3.411 0 5.117 2.388 3.752-3.07 8.868-4.775 5.116-1.706 10.233-3.07 5.457-1.364 9.891-3.07 4.776-1.705 7.504-4.775 1.706 0.341 5.458 0.341 5.798 0 10.915-1.364 5.457-1.706 10.915-3.07l7.163-0.682q2.728-0.342 4.775-1.706 2.388-1.364 4.775-2.388 2.388-1.023 4.775-1.705 2.729-0.682 6.481-0.341 8.186-4.434 17.396-6.822 9.209-2.388 18.76-4.093 9.551-2.047 18.76-4.434 9.209-2.729 17.396-7.845h1.023q6.822 0 13.303-2.388 6.821-2.388 12.62-6.481 1.023 0.341 2.047 0.341h2.387q9.551 0 18.419-2.728 9.21-2.729 19.101-2.729 5.799 0 9.21 1.705 3.411 1.365 6.139 3.752 2.729 2.047 5.799 4.093 3.07 2.047 7.845 3.07 3.07 5.799 3.07 12.621 0 6.48 0.341 13.302z"/>
                            <path d="m-24825 39234q0 3.07-0.341 6.14 0 3.07-0.341 5.799-1.024 1.705-4.093 1.364-2.729-0.341-4.435-0.341-1.705 0-3.069 0.682-1.024 0.341-1.024 2.047 0 2.046 0.341 2.728-2.728-0.341-5.798-0.682t-5.458-2.046q-4.775 1.023-9.209 2.728-4.093 1.706-8.186 3.752-4.093 2.047-8.528 3.752-4.434 1.706-9.209 2.047-3.07 3.411-7.845 5.116-4.775 1.706-9.892 3.07-5.116 1.364-9.55 3.411-4.435 1.705-7.163 5.457-7.504 0.683-14.326 3.752-6.822 3.07-13.644 6.481-6.481 3.411-13.302 6.481-6.822 3.07-14.667 4.093-2.047 2.047-5.117 3.411-2.729 1.364-5.798 2.729-3.07 1.023-5.799 2.387-2.729 1.365-4.434 3.752h-0.682q-1.365 0-2.047-0.682t-2.046-0.682q-1.024 0-1.365 0.341-8.186 3.752-16.372 7.845t-17.055 7.845q-17.395 7.163-35.132 13.985t-34.109 16.714q-3.752 13.643-6.14 27.969-2.388 13.985-8.527 26.946v16.032q-3.411 6.48-4.435 14.326-1.023 7.845-1.023 15.008 0 2.728 0 5.116 0.341 2.047 0.341 4.434 9.892-2.729 19.101-6.139 9.551-3.411 19.102-6.14 4.775-1.706 9.55-2.388 5.117-0.682 9.892-2.387 3.752-1.024 7.845-2.729 4.093-2.047 7.845-3.752 10.233-4.434 20.807-7.845 10.915-3.411 22.171-5.117 3.411-2.728 7.504-5.116t8.186-2.388q3.07 0 5.116 1.024 5.799-3.411 13.644-6.14t14.667-2.047q1.705-2.387 4.093-3.069 2.388-1.024 5.116-1.024 1.365 0 2.388 0.341 1.364 0 3.07 0 3.411-2.387 7.504-3.411 4.093-1.023 8.186-1.705t7.845-1.705q4.093-1.365 7.163-4.094 4.775 0.342 7.504 2.729 3.07 2.388 5.116 5.799 2.047 3.411 3.411 7.163 1.365 3.752 3.411 7.163-0.682 2.728-2.046 4.434-1.365 1.364-3.07 2.729-1.706 1.364-3.07 2.728-1.364 1.365-1.705 3.752-11.939 0-23.195 3.411-10.915 3.411-21.83 7.845-10.573 4.434-21.829 8.528-10.915 3.752-22.512 4.775-1.706 1.705-4.435 2.729l-5.116 1.705q-2.388 0.682-4.434 2.047-2.047 1.023-3.07 3.411-2.047-1.024-4.434-1.024-5.799 0-11.256 3.07-5.458 3.07-12.28 3.07-2.728 0-3.752-0.341-1.705 3.07-5.116 4.434-3.07 1.364-6.822 2.388-3.411 0.682-6.822 2.046-3.069 1.365-4.775 4.776-1.023-0.342-2.388-0.342h-2.046q-5.458 0-12.621 2.047-6.821 1.705-9.891 6.822-2.729-0.682-4.775-0.682-4.776 0-8.528 2.046-3.752 1.706-7.504 4.093l-7.504 4.776q-3.752 2.387-8.186 3.41-8.868 12.621-12.279 28.993-3.411 16.373-5.117 34.109-1.364 17.737-2.728 35.133-1.365 17.737-5.458 32.404 2.047 5.457 3.07 11.597 1.023 6.139 1.705 12.279 0.683 6.481 1.365 12.962 0.682 6.48 2.387 12.279 1.706 7.163 6.481 12.62 5.117 5.799 7.163 12.962 1.706 0.341 3.411 0.341 2.047 0.341 4.093 0.341 12.279 0 21.489-4.775 9.55-4.776 17.737-11.939 8.186-6.821 15.69-15.008 7.845-7.845 16.713-13.984h6.481q2.388-2.729 4.093-5.799 1.706-3.07 3.752-5.798 2.047-2.729 4.776-4.776 2.728-1.705 6.821-2.387 1.024-5.117 4.776-7.846 3.752-2.728 5.116-8.186 0.682 0.341 1.705 0.341 2.729 0 4.094-1.364l5.116-4.775q2.729-2.729 5.799-5.458 3.41-2.387 6.48-4.775 9.892-7.163 19.784-14.326 9.891-6.822 18.077-16.031 0.342 0.341 1.024 0.341 2.728 0 3.752-1.706 1.023-1.705 4.775-1.023 2.047-3.07 3.752-6.14 1.705-3.41 2.729-7.162l10.915 1.364q5.457 0.682 10.915 0.682 1.705 0 3.069 0 1.706-0.341 3.07-1.023 4.093 6.481 4.434 13.985 0.342 7.163 1.706 14.325-0.682 0-1.023 0 0-0.341-0.683-0.341-1.705 0-3.41 1.365-1.365 1.023-3.07 2.728l-3.411 3.411q-1.706 1.706-3.07 2.729-3.752 2.388-7.845 4.093-4.093 2.047-7.845 4.093-3.752 2.047-7.163 4.776-3.411 3.069-5.458 7.504-6.821 2.728-13.302 5.798-6.14 3.07-11.938 6.481-1.706 1.705-3.07 3.411-1.365 1.705-2.047 3.752-9.209 3.07-15.349 9.209-5.798 6.14-11.938 13.303l-0.341-0.341q-2.388 0-3.07 1.705-0.341 1.706-3.752 1.024-6.481 7.162-13.644 13.302t-14.667 12.279q-7.504 6.14-15.008 12.28-7.504 6.48-13.984 13.643-4.435 1.365-8.528 3.411-4.093 2.047-6.139 6.14h-1.024q-3.752 0-5.457 1.705-1.365 1.706-3.411 4.435-7.163 1.705-14.667 3.752-7.504 2.046-15.349 2.046-5.458 0-10.574-2.046-4.775-2.047-9.551-5.458-4.434-3.07-8.527-6.822-3.752-3.752-7.163-7.163-2.046-6.821-5.457-14.325-3.07-7.163-3.07-13.985 0-1.706 0.341-3.411 0.682-1.364 0.682-2.729 0-2.388-1.705-2.046-1.365 0.341-2.047-1.706-0.682-3.411-1.023-7.845 0-4.093-0.682-7.845-1.024-7.845-2.729-16.031-1.364-8.187-3.07-16.032 1.365-0.682 2.047-2.387 1.023-1.365 2.046-2.729-1.023-2.729-2.046-6.14-0.682-3.07-0.682-6.48 0-6.822 5.116-10.233 0-2.388-1.364-3.752-1.024-1.024-1.024-3.752 0-0.682 0.341-3.752 0.683-3.411 1.365-7.504 1.023-4.093 1.705-7.845t1.023-5.117q2.388-15.69 4.094-30.698 1.705-15.349 4.775-30.698-3.411-2.729-8.869-4.093-5.116-1.706-7.162-4.435-1.706-2.387-2.729-6.139-1.024-3.752-1.024-6.481 0-9.892 7.846-15.69 7.845-6.14 16.713-7.163 4.434-11.938 6.481-24.218 2.387-12.62 3.752-25.24l2.729-25.582q1.364-12.962 4.093-25.582h-2.047q-6.822 0-13.302 2.046-6.481 2.047-13.303 2.047h-0.682q-9.892-7.845-9.892-18.76 0-6.481 2.729-12.962 5.457-2.046 9.892-5.457 4.434-3.411 8.868-6.822 4.775-3.752 9.55-6.481 4.776-2.728 10.574-3.411 0.683-9.891 3.411-19.783 2.729-9.892 2.729-19.783 0-2.047-0.341-4.093 0-2.047-0.682-4.094 2.387-3.069 3.07-6.48 1.023-3.411 1.023-7.163 0-4.093-0.682-7.845-0.341-4.093-1.024-7.845 3.07-1.365 4.776-2.729 1.705-1.706 3.069-3.07 1.706-1.364 4.094-2.388 2.387-1.023 6.821-1.023 6.481 0 10.915 2.729 4.776 2.388 8.187 6.481 3.41 4.093 5.798 9.209 2.729 5.116 5.116 10.233-0.682 3.752-3.069 5.457-2.388 1.706-4.093 4.434 0.682 5.458 1.364 10.574 0.682 4.776 0 10.233 3.411 1.706 6.481 1.706 5.116 0 9.209-2.729 4.434-2.729 6.14-7.504h0.682q1.023 0 1.705 0.682 1.024 0.682 2.388 0.682h1.364q3.752-3.411 8.187-5.116 4.434-2.047 9.209-3.752 4.775-1.706 9.21-3.411 4.775-2.047 8.868-5.117 2.047 1.024 4.434 1.024 3.411 0 6.481-1.365 3.411-1.364 6.481-2.728 3.07-1.706 6.48-3.07 3.752-1.365 7.846-1.365 0.682 0 1.705 0.342 1.023 0 1.705 0 2.388 0 2.729-1.706 0.341-1.705 0-3.07 10.915-2.728 18.76-6.139 8.186-3.752 18.078-8.528 0-0.341 0.682-0.341 1.024 0 1.365 1.024 0.341 1.023 0.341 1.705 2.046-1.023 2.046-3.411 0.341-2.388 1.706-4.093 1.364 0.341 3.752 0.341 3.07 0 6.139-1.364 3.411-1.365 6.481-3.07 3.07-1.706 6.14-3.07t6.139-1.364q2.729 0 4.435 1.364 2.046-1.023 4.093-2.729 2.046-2.046 4.434-2.046 0.682 0 1.023 0.341 0.682 0.341 1.365 0.682 1.705-1.705 3.069-2.729 1.706-1.023 1.706-3.411 12.62-1.364 23.194-5.457 10.915-4.434 20.807-11.597 3.752 0.682 7.163 1.705 3.752 0.682 7.504 0.682 2.046 3.752 3.752 7.504 1.705 3.752 7.504 3.411 0.341 1.706 0.341 3.752 0.341 2.047 0.341 3.752z"/>
                            <path d="m-24455 39621q-0.682 6.822-4.775 10.574-4.093 4.093-10.574 4.093-3.411 0-6.48-1.023-6.481 5.117-15.35 7.845-8.868 2.729-16.713 5.458-9.551-0.341-18.76-1.706-9.21-1.364-19.101-0.682-3.411-2.388-7.163-3.07t-7.845-1.023q-3.752 0-7.504-1.023-3.411-1.024-6.822-4.776h-17.055q-2.387 0-7.163-2.387-4.434-2.047-10.232-4.434-5.458-2.388-11.939-4.435-6.139-2.046-11.597-2.046h-2.046q-3.752-3.07-8.869-4.775-4.775-1.365-9.891-2.729-5.117-1.023-9.892-2.388-4.775-1.364-8.186-3.752-3.411-2.387-7.845-4.775-4.435-2.729-9.21-2.388-6.481-3.752-13.644-6.48-6.821-2.729-13.984-5.117l-13.985-5.116q-6.822-2.729-13.644-6.481-1.023 0.341-2.387 0-1.365-0.341-2.388-0.341-2.047 0-2.388 1.364-2.387-2.387-5.457-4.093-2.729-1.705-5.458-4.093-1.364 0.341-2.728 0.682-1.024 0-2.729 0-3.07 0-6.14-0.682-2.728-0.682-5.457-1.705-3.07 6.821-4.093 15.349-1.024 8.527-1.706 17.737-0.341 8.868-1.023 17.736-0.682 9.21-3.07 16.714 0.682 2.729 0.682 5.457v5.799q0 5.798 1.706 9.209-0.682 3.07-1.365 5.799-0.341 2.729-1.023 5.457 0.341 3.752 0.341 6.822 0.341 3.411 0.341 7.163v5.799q0 3.069-0.682 6.139-3.411 2.047-6.822 3.752-3.411 2.047-6.822 4.776-2.387-4.435-8.186-5.117-1.364 1.706-2.046 4.434-0.341 3.07-3.07 3.07-4.775-3.752-7.845-6.139-3.07-2.388-6.822-7.163-0.341-0.683-0.341-1.706 0-1.705 0.682-3.07 0.682-1.364 0.682-2.728 0-4.093-1.023-7.163-0.682-4.434-1.023-8.869-0.341-4.093-0.341-8.186 0-5.798 0.682-11.256 1.023-5.457 3.411-11.256 3.752-9.892 5.116-20.807 1.706-10.914 2.388-21.829 0.682-11.256 0.682-22.512 0.341-11.256 1.364-21.489-2.387-5.458-5.798-8.528-3.07-3.41-3.07-10.573 0-6.481 4.093-9.892 4.093-3.752 7.163-8.868-0.682-2.047 1.023-2.729l4.093-35.815q0.341-3.752 1.024-8.186 1.023-4.434 1.364-8.186 0.682-7.845 0.682-15.349t0.682-15.008q1.706-16.714 3.07-33.086 1.706-16.373 1.706-32.745 0-7.845-0.683-15.69-0.341-7.845-2.046-15.691-5.799 1.706-12.962 3.752-6.821 1.706-11.597 6.14h-2.729q-8.868 0-16.713 3.411-7.504 3.411-15.349 6.481-3.411 1.705-6.822 2.387-3.411 0.342-7.163 1.365-1.705 0.341-3.752 2.046-2.046 1.706-3.752 2.388l-5.798 1.364q-2.388 0.683-2.047 3.07 0.341 2.388-1.706 3.07-1.705 1.705-4.775 1.705-3.07-0.341-4.775-0.341h-1.364q-8.528 6.14-16.373 10.574-8.186 4.093-19.101 5.458l-7.504 4.775q-3.752 2.388-8.527 2.388-3.752 0-6.14-1.365-2.729-4.093-4.093-9.209-1.706-5.117-5.458-8.869 1.706-1.705 2.388-4.434 0.341-3.07 1.023-5.457 10.233-4.434 20.807-8.528 10.233-4.093 19.783-9.891 1.024 0.341 3.07 0.341 3.411 0 6.14-1.023 2.729-1.024 5.457-2.388 2.729-1.364 5.458-2.388 2.728-1.023 6.48-0.682 11.598-6.481 24.559-10.574 12.962-4.093 24.559-11.256 1.705 0 2.728 0.682 1.365 0.683 2.729 0.683 1.365 0 1.706-0.342 2.046-2.728 5.457-3.752 3.411-1.364 6.822-2.046 3.752-1.023 6.822-2.388 3.411-1.705 4.434-5.116 1.705 1.364 5.116 1.364 5.799 0 10.574-2.387 5.117-2.388 10.915-2.388 1.364 0 2.388 0.682 1.364 0.341 2.729 0.341 2.728 0 2.728-1.705 0.341-1.706 2.047-3.07 20.806-3.752 41.272-6.822 20.806-3.07 41.954-3.07 3.07-2.046 6.822-2.046t6.822 2.046q5.798-0.682 11.597-1.023t11.597-0.341q13.303 0 27.287 1.705 13.985 1.706 27.629 5.458 13.985 3.411 26.605 9.55 12.62 5.799 23.535 13.985 1.024 3.07 2.729 6.14 1.706 3.07 4.434 4.775 0 0.682-0.341 1.023 0 0.342 0 1.024 0 3.752 2.047 7.163 2.387 3.411 2.387 8.186t-1.705 9.55q-1.364 4.776-1.023 9.551-3.752 5.457-6.481 9.892-2.388 4.434-3.07 11.256-6.14 6.139-10.915 13.643-4.775 7.163-9.891 14.326-4.776 6.822-10.915 12.621-6.14 5.798-14.667 9.209-0.341 3.411-2.729 7.504h-7.163q-1.023 2.729-3.411 4.093l-4.775 2.729q-2.388 1.364-4.093 3.411-1.365 2.046-1.365 5.798-0.682-0.341-1.705-0.341-3.411 0-8.186 3.411-4.435 3.411-7.163 5.458-5.799 4.093-11.939 7.504-5.798 3.411-10.232 9.55-13.644 5.799-25.923 13.644-12.28 7.504-26.605 11.938-5.458 5.799-12.962 9.21-7.163 3.069-13.985 6.822v1.023q0 2.729 2.047 5.457 2.046 2.388 4.775 4.434 2.729 1.706 5.799 2.388 3.411 0.682 5.798 0 6.822 6.14 15.691 9.892 8.868 3.752 18.418 6.822 9.551 3.069 18.761 6.48 9.209 3.411 17.054 8.528h8.186q7.845 6.821 18.419 10.232 10.915 3.411 20.807 6.14 4.093 3.752 10.233 5.799 6.48 1.705 12.279 1.705h2.046q1.365 0 2.388-0.341v0.682q0 1.706 1.023 2.388 1.024 0.341 2.047 0.682 1.364 0 2.388 0.682 1.364 0.341 2.046 1.365h3.411q7.163 0 13.644 3.069 6.48 2.729 13.643 2.729 3.07 0 4.776-0.682 2.046 0.682 3.07 2.729 1.023 2.046 2.728 3.411 2.388-0.342 4.434-0.683 2.047 0 4.094 0 7.504 0 13.984 1.706 6.481 1.705 13.303 5.116 10.915-4.775 21.489-7.845t22.512-3.07v0.682q0 4.094 2.046 7.504 2.388 3.752 4.093 7.504zm-130.64-272.19q0-4.093-1.705-6.481-1.365-2.387-3.752-4.093-2.388-2.046-5.117-3.752-2.387-1.705-4.434-4.434-8.868-2.729-17.395-6.139-8.528-3.411-17.396-5.799-4.434-1.023-8.869-1.706-4.434-1.023-8.868-1.023h-7.504q-2.047-0.341-4.434-0.682-2.047-0.682-4.093-1.023-4.776-0.682-9.551-1.024-4.434-0.341-9.209-0.341-8.869 0-17.737 0.683l-17.737 1.364q-3.752 0.341-7.845 0.341t-7.504 0.682q-1.705 0.341-4.775 1.706-3.07 1.023-6.481 2.387-3.411 1.024-6.822 2.388-3.07 1.364-5.457 2.047 0.341 2.387 0.341 4.775v4.434q0 5.116-0.341 10.233-0.341 5.116-1.365 10.233-0.341 2.046-1.023 4.093-0.682 2.046-1.023 4.093-0.682 3.07-0.682 6.822v6.48q-0.683 7.845-1.024 15.349t-1.023 15.35q-2.047 22.512-4.434 44.683-2.047 22.171-2.729 44.683 11.256-2.388 21.489-7.163 10.233-4.776 20.124-10.233 9.892-5.799 19.784-11.256 9.891-5.458 20.806-9.21 2.729-3.752 6.481-6.139 4.093-2.388 6.822-6.14 3.411 0 5.116-1.364 1.706-1.706 4.434-2.388 16.373-14.326 33.427-26.946 17.055-12.621 32.745-26.946 1.365-4.776 4.434-9.21 3.411-4.775 6.481-9.55 3.07-4.776 5.458-9.551 2.387-4.775 2.387-10.233z"/>
                            <path d="m-24227 39299q0 11.938-4.434 23.194-4.435 10.915-6.481 22.512-7.504 9.892-13.985 20.465-6.481 10.574-13.302 21.148-6.822 10.574-14.326 20.466-7.504 9.55-17.055 17.395 0.341 0.341 0.341 1.365 0 2.046-2.046 3.411-1.706 1.023-1.024 2.728-8.527 8.869-16.713 17.396t-15.008 19.101q-7.504 3.752-12.279 12.279-2.047 0-3.07 1.024-1.024 0.682-2.729 1.364-10.915 13.303-22.853 25.241t-25.582 21.83q-5.116 3.752-10.233 6.822-5.116 3.069-9.891 6.48-3.07 2.047-6.14 4.776-2.729 2.728-5.799 5.116-9.891 8.527-19.442 14.326-9.55 5.457-22.512 7.504-1.023 3.752-1.023 8.186v8.186q0 4.093-0.341 8.528-0.341 4.093-2.388 7.845v1.023q0 3.411 1.706 6.481 1.705 3.411 1.705 6.822 0 2.387-2.388 4.093h8.869q0 4.775 2.728 8.186 3.07 3.411 3.07 5.116 0 5.799-1.364 12.621-1.023 7.163-6.822 9.55v2.047q0 3.411-0.682 6.481-0.682 3.41-3.07 6.48-2.046 0-4.093 0-1.706 0.341-3.411 0.341-14.326 0-25.582-6.821-3.752-8.869-5.116-18.419-1.024-9.21-1.024-18.76 0-18.761 2.729-37.179 2.729-18.419 4.434-36.838l5.117-9.892q0.682-9.551 2.387-19.101 1.706-9.892 3.411-19.442 1.706-9.551 2.729-19.102 1.364-9.55 1.023-19.101 2.729-5.798 3.752-12.279 1.365-6.481 1.365-12.62 0-3.411-0.341-6.822t-2.047-6.481q2.047-1.364 2.729-3.411 0.682-2.046 2.046-3.752 1.024-13.303 1.706-26.264 0.682-13.303 0.682-26.264 0-7.163-0.341-13.985-0.341-7.163-1.023-14.326-0.341-2.728-1.365-6.48-0.682-3.752-0.682-5.799 0-2.729 0.341-5.457 0.341-3.07 0.341-6.14 0-3.411-0.682-6.481-0.682-3.411-2.388-6.14-16.372 4.776-29.333 12.962-12.962 7.845-26.264 17.737-5.458 3.752-11.939 8.868-6.48 5.117-12.279 7.845-1.023 0.682-2.388 1.024-1.705 0-2.728 0-3.752 0-6.822-0.342-3.07-0.682-6.14-0.682-4.775-4.775-11.256-7.504-1.023-4.093-1.023-8.868t1.023-9.21q0.682-4.434 2.388-8.868 4.093-1.364 8.868-3.07 4.434-1.705 8.869-3.752 4.093-2.388 7.504-5.116 3.41-3.07 5.457-7.504 2.047 1.023 3.752 1.023t3.07-0.341q1.364-0.341 3.07-0.682 6.139-3.752 12.279-7.845 6.481-4.093 13.303-6.822 2.046-0.682 2.387-1.706 0.341-1.023 0-3.07 7.845-2.387 16.373-5.457 8.527-3.411 14.325-9.209h6.14q5.116-3.752 10.915-6.14t11.597-4.434q6.14-2.388 11.938-4.776 5.799-2.728 10.915-6.821 2.047-0.683 3.411-0.683 1.706 0 3.752 0.683 3.411-1.706 5.799-4.094l5.457-5.457q5.458 0 9.892-1.023 4.434-1.024 8.527-2.729t7.845-3.752q4.093-2.388 8.869-4.775 2.046 0.682 3.07 1.705 1.023 0.682 3.41 0.682 3.411-2.387 7.163-3.411 4.094-1.364 8.187-2.046t7.845-1.706q4.093-1.023 7.163-3.752 10.915 0 21.83-0.341 11.256-0.682 22.17-0.682 15.691 0 31.722 2.388 16.372 2.387 29.334 11.938 5.116 12.279 14.667 20.807 0.682 3.752 1.364 7.163 1.024 3.069 2.388 6.139-2.388 5.117-2.388 11.256 0 6.14 1.024 12.28 1.364 5.798 1.364 11.597zm-31.722-8.187q-1.705-3.069-2.387-6.821-0.341-4.094 0-7.846-4.434-3.41-6.822-8.868-2.388-5.457-6.822-8.186-3.07-1.706-8.868-2.047-5.458-0.341-9.21-1.364-4.434-1.364-6.139-2.729-1.365-1.364-6.14-1.364-4.093 0-8.186 1.023-4.093 0.682-8.187 0.682-3.41 0-6.48-1.364t-6.481-1.364q-3.752 0-7.163 2.387-3.07 2.388-7.504 1.365-2.047 1.705-2.388 2.728 0 1.024-0.341 1.706-0.341 0.341-1.705 0.341h-4.775q-7.163 0-14.667 2.046-7.163 2.047-12.962 6.822-1.023-0.341-2.046-0.341-0.683-0.341-1.706-0.341-5.798 0-11.256 3.411-5.116 3.07-11.597 3.07-4.093 4.093-9.892 6.481-5.798 2.387-11.938 4.775-5.799 2.046-10.915 5.116-5.116 2.729-7.845 8.186-0.341 2.729 1.705 3.411 2.047 0.683 2.047 3.411 0 2.388-1.023 5.799-0.682 3.411-0.682 6.822 0 7.845 1.705 15.349t3.411 15.349q-1.706 1.023-2.388 3.07-0.682 2.046-2.387 3.07 4.775 14.325 4.775 29.333 0 11.939-2.729 23.536-2.387 11.256-3.411 23.194v0.341q0 2.047 1.365 2.729 1.364 0.682 1.364 2.388 0 1.023-0.341 1.705-3.752 23.194-7.504 46.388-3.411 23.195-5.799 46.73h2.729q8.868 0 15.69-5.116 7.163-5.458 11.939-11.939h5.457q24.559-21.488 47.071-44.341 22.853-22.854 43.318-49.118 2.729 0 3.752-1.364 1.024-1.364 3.411-2.047 7.163-9.891 15.008-19.442 7.845-9.891 17.055-18.76 0.341-3.411 1.705-6.14 1.706-2.728 3.411-5.116 1.706-2.388 3.07-5.116 1.364-2.729 1.364-6.481 1.706-0.682 3.752-1.364 2.047-1.024 3.752-2.729 0.683-3.411 2.388-6.14 1.706-2.729 1.706-6.139 0-1.365-0.683-3.411 5.458-2.388 8.528-7.845 3.07-5.458 4.775-11.939 1.705-6.822 2.388-13.643 1.023-6.822 2.728-11.939z"/>
                            <path d="m-23908 39417q0 19.443-2.729 37.862-2.388 18.077-7.163 36.838-4.434 3.41-5.457 8.527-1.024 5.116-3.411 9.55-2.047 3.752-5.458 8.187-3.411 4.093-7.504 8.868-4.093 4.434-8.186 9.209-4.093 4.776-6.822 9.551-10.233 3.411-14.667 14.667-5.457 2.047-11.256 4.775-5.798 2.388-8.186 8.528-12.62 6.48-23.876 15.008-10.915 8.186-23.877 14.325-1.705 1.706-4.093 2.729-2.046 0.682-4.434 1.706-2.047 1.023-4.093 2.387-1.706 1.706-2.047 4.093-1.364 0-2.046-0.682-0.341-0.341-2.047-0.682-3.752 2.047-3.411 6.481-1.364-0.682-3.752-0.682-4.093 0-8.186 2.387-3.752 2.729-6.481 5.458-4.093 2.046-9.55 4.093-5.117 2.046-7.504 6.822-1.365-1.365-4.093-1.365-3.07 0-6.481 1.706-3.411 2.046-5.117 4.434-4.775 0-9.209 1.364-4.093 1.706-8.527 3.07-4.435 1.706-8.869 3.07-4.093 1.364-8.868 1.364-2.729 0-4.093-1.364-1.365-1.364-3.411-2.388-1.706 1.365-6.14 3.07-4.093 1.706-6.139 1.706-3.752 0-7.504-1.024-3.411-1.023-7.163-2.387l-7.163-2.388q-3.411-1.023-7.504-1.364-3.07-2.729-7.504-5.799-4.093-2.729-8.187-1.705-1.705-5.117-5.116-8.869t-7.845-6.822q-1.023-0.682-2.388-1.364-1.023-0.341-1.705-1.023-1.706-1.024-3.07-4.093-1.364-3.07-3.07-3.07-0.341 0-1.023 0.341-0.341 0.341-0.682 0.341-0.682-3.07-2.047-5.799-1.364-3.069-4.775-3.752-2.729-8.868-3.752-17.736-1.023-8.869-2.729-17.737-0.682-2.729-1.705-6.481-0.682-4.093-0.682-7.163 0-5.116 1.364-12.279 1.705-7.163 2.729-12.62 4.093-19.784 10.915-38.203 6.821-18.76 14.666-37.179 8.187-18.419 16.714-36.497 8.527-18.077 16.031-36.838 1.365 0 1.706-0.682l1.023-1.705q0.682-1.023 1.023-1.706 0.683-0.682 2.388-0.682v-1.023q-0.341-2.047 0.682-3.411 1.365-1.364 0.682-4.434 5.458-6.14 9.21-13.644 3.752-7.845 7.504-15.349 4.093-7.504 8.527-14.667t11.256-12.279v-2.388q-0.341-1.705 0-3.411 0.682-2.046 2.388-2.729 6.139-6.139 10.233-12.279 4.093-6.14 8.186-11.938 4.434-6.14 9.55-11.256 5.458-5.458 13.644-9.892 3.752-1.705 5.457-5.116 1.706-3.411 4.435-4.775 1.364-0.683 2.728-0.683 1.706-0.341 3.07-1.023 5.799-1.705 11.597-4.093 5.799-2.729 12.28-2.729 8.186 0 12.279 4.776 4.434 4.434 6.822 10.915 2.729 6.48 4.434 13.643t5.457 12.279q10.233 0.683 20.807 2.388 10.574 1.364 18.419 8.527 0.682 0.342 1.705 0.342 1.706 0 1.706-1.365 0-1.364 1.705-1.364h1.024q10.232 6.139 19.442 13.643 9.55 7.163 18.76 15.008 1.705 1.365 3.411 2.729 2.046 1.024 3.411 2.729 1.705 2.047 3.07 4.775 1.705 2.729 3.069 4.776 17.055 29.675 22.854 63.784 0.682 3.752 1.023 7.163 0.682 3.411 0.682 6.48 0 3.07 1.364 4.093 1.365 0.683 1.365 3.411zm-26.264 17.396q0-13.644-3.411-26.264 1.705-0.682 2.046-2.047 0.683-1.705 0.683-3.41v-1.706l-4.094-7.504q-0.341-4.775-2.046-8.868-1.364-4.093-3.411-8.187-2.047-4.093-4.093-8.186-1.706-4.093-2.388-8.868-5.457-4.093-9.891-9.21-4.094-5.457-7.504-11.256-2.388-1.023-4.435-1.364-2.046-0.341-1.364-3.752-6.14-1.705-11.256-4.775-4.775-3.411-9.551-7.504-7.845-1.706-15.69-4.093-7.504-2.729-15.349-2.729-5.457 0-10.574 2.046 1.706 2.729 1.706 6.14 0 3.07 0.682 6.14 10.915 2.728 13.302 13.302-1.705 1.024-3.069 2.729-1.365 1.364-2.729 2.729-1.023 1.023-2.729 2.046-1.705 1.024-4.093 1.024-4.775 0-7.504-1.706-2.388-1.705-7.845-0.682-5.799-5.116-11.256-10.574-5.458-5.798-12.279-10.233-1.024-3.411-3.411-6.139-2.047-2.729-4.435-5.117-2.046-2.728-4.093-5.457-1.705-3.07-1.705-6.822 0-2.388 0.341-3.411-2.047-0.682-3.07-0.682-2.729 0-5.116 2.046-2.388 1.706-5.458 2.388-2.728 8.186-7.845 14.326-5.116 6.14-10.574 11.938-5.457 5.799-10.232 12.279-4.435 6.14-6.481 15.35-10.915 13.643-20.125 31.039-9.209 17.055-13.984 33.427-7.845 8.868-12.28 18.76-4.434 9.892-5.116 21.83-1.706 1.023-2.729 2.729l-3.411 6.821q-0.682 1.706-2.387 2.729v1.706q0 2.728-1.024 5.116-1.023 2.047-2.387 4.093-1.024 2.047-2.047 4.093-1.023 1.706-1.023 4.093 0 2.729 1.364 5.458-3.752 0.682-5.116 4.093-1.023 3.07-3.07 5.457-1.364 10.915-2.729 22.171-1.364 11.256-1.364 22.171 0 12.621 2.729 25.582 3.07 3.07 5.457 6.822 2.388 3.752 4.775 7.163 2.729 3.411 5.799 6.14 3.07 2.387 8.186 3.069 0 2.388 1.024 3.411 1.023 1.024 1.705 2.729 7.163 2.388 15.008 3.752 7.845 1.706 15.69 1.706 5.458 0 10.915-1.365 5.799-1.364 9.551-5.457 17.395-0.682 34.45-8.186 17.396-7.505 31.722-16.373h7.162q3.752-5.116 9.21-8.186 5.457-3.411 11.256-6.14 1.023-0.682 2.729-1.364 1.705-0.682 2.728-1.364 3.752-2.729 7.504-6.14 4.094-3.411 8.187-6.481 6.822-5.116 13.984-9.892 7.163-4.775 13.644-10.232 6.822-5.458 12.621-11.597 6.139-6.481 10.232-14.326 2.047 0 3.07-1.024 1.364-1.364 2.047-2.728 1.023-1.365 2.046-2.388 1.365-1.023 3.752-1.023 0-3.07 1.023-5.117 1.365-2.387 2.729-4.093 1.706-2.046 3.07-3.752 1.705-1.705 3.07-4.434v-9.55q5.457-8.869 7.845-18.761 2.729-9.891 2.729-20.124z"/>
                            <path d="m-23477 39621q-0.682 6.822-4.776 10.574-4.093 4.093-10.573 4.093-3.411 0-6.481-1.023-6.481 5.117-15.349 7.845-8.869 2.729-16.714 5.458-9.55-0.341-18.76-1.706-9.209-1.364-19.101-0.682-3.411-2.388-7.163-3.07t-7.845-1.023q-3.752 0-7.504-1.023-3.411-1.024-6.822-4.776h-17.054q-2.388 0-7.163-2.387-4.435-2.047-10.233-4.434-5.458-2.388-11.938-4.435-6.14-2.046-11.597-2.046h-2.047q-3.752-3.07-8.868-4.775-4.776-1.365-9.892-2.729-5.116-1.023-9.892-2.388-4.775-1.364-8.186-3.752-3.411-2.387-7.845-4.775-4.434-2.729-9.21-2.388-6.48-3.752-13.643-6.48-6.822-2.729-13.985-5.117l-13.985-5.116q-6.822-2.729-13.643-6.481-1.024 0.341-2.388 0t-2.388-0.341q-2.046 0-2.387 1.364-2.388-2.387-5.458-4.093-2.729-1.705-5.457-4.093-1.365 0.341-2.729 0.682-1.023 0-2.729 0-3.07 0-6.139-0.682-2.729-0.682-5.458-1.705-3.07 6.821-4.093 15.349-1.023 8.527-1.705 17.737-0.342 8.868-1.024 17.736-0.682 9.21-3.07 16.714 0.683 2.729 0.683 5.457v5.799q0 5.798 1.705 9.209-0.682 3.07-1.364 5.799-0.341 2.729-1.024 5.457 0.342 3.752 0.342 6.822 0.341 3.411 0.341 7.163v5.799q0 3.069-0.683 6.139-3.41 2.047-6.821 3.752-3.411 2.047-6.822 4.776-2.388-4.435-8.186-5.117-1.365 1.706-2.047 4.434-0.341 3.07-3.07 3.07-4.775-3.752-7.845-6.139-3.07-2.388-6.822-7.163-0.341-0.683-0.341-1.706 0-1.705 0.682-3.07 0.683-1.364 0.683-2.728 0-4.093-1.024-7.163-0.682-4.434-1.023-8.869-0.341-4.093-0.341-8.186 0-5.798 0.682-11.256 1.023-5.457 3.411-11.256 3.752-9.892 5.116-20.807 1.706-10.914 2.388-21.829 0.682-11.256 0.682-22.512 0.341-11.256 1.365-21.489-2.388-5.458-5.799-8.528-3.07-3.41-3.07-10.573 0-6.481 4.093-9.892 4.093-3.752 7.163-8.868-0.682-2.047 1.024-2.729l4.093-35.815q0.341-3.752 1.023-8.186 1.023-4.434 1.364-8.186 0.682-7.845 0.682-15.349t0.683-15.008q1.705-16.714 3.069-33.086 1.706-16.373 1.706-32.745 0-7.845-0.682-15.69-0.341-7.845-2.047-15.691-5.798 1.706-12.961 3.752-6.822 1.706-11.597 6.14h-2.729q-8.869 0-16.714 3.411-7.504 3.411-15.349 6.481-3.411 1.705-6.822 2.387-3.411 0.342-7.163 1.365-1.705 0.341-3.752 2.046-2.046 1.706-3.752 2.388l-5.798 1.364q-2.388 0.683-2.047 3.07 0.341 2.388-1.705 3.07-1.706 1.705-4.775 1.705-3.07-0.341-4.776-0.341h-1.364q-8.527 6.14-16.373 10.574-8.186 4.093-19.101 5.458l-7.504 4.775q-3.752 2.388-8.527 2.388-3.752 0-6.14-1.365-2.728-4.093-4.093-9.209-1.705-5.117-5.457-8.869 1.705-1.705 2.387-4.434 0.342-3.07 1.024-5.457 10.232-4.434 20.806-8.528 10.233-4.093 19.784-9.891 1.023 0.341 3.069 0.341 3.411 0 6.14-1.023 2.729-1.024 5.458-2.388 2.728-1.364 5.457-2.388 2.729-1.023 6.481-0.682 11.597-6.481 24.558-10.574 12.962-4.093 24.559-11.256 1.706 0 2.729 0.682 1.364 0.683 2.729 0.683 1.364 0 1.705-0.342 2.047-2.728 5.457-3.752 3.411-1.364 6.822-2.046 3.752-1.023 6.822-2.388 3.411-1.705 4.434-5.116 1.706 1.364 5.117 1.364 5.798 0 10.574-2.387 5.116-2.388 10.914-2.388 1.365 0 2.388 0.682 1.364 0.341 2.729 0.341 2.729 0 2.729-1.705 0.341-1.706 2.046-3.07 20.807-3.752 41.272-6.822 20.807-3.07 41.955-3.07 3.069-2.046 6.821-2.046t6.822 2.046q5.799-0.682 11.597-1.023 5.799-0.341 11.597-0.341 13.303 0 27.288 1.705 13.985 1.706 27.628 5.458 13.985 3.411 26.605 9.55 12.621 5.799 23.536 13.985 1.023 3.07 2.728 6.14 1.706 3.07 4.435 4.775 0 0.682-0.341 1.023 0 0.342 0 1.024 0 3.752 2.046 7.163 2.388 3.411 2.388 8.186t-1.706 9.55q-1.364 4.776-1.023 9.551-3.752 5.457-6.481 9.892-2.387 4.434-3.07 11.256-6.139 6.139-10.914 13.643-4.776 7.163-9.892 14.326-4.775 6.822-10.915 12.621-6.14 5.798-14.667 9.209-0.341 3.411-2.729 7.504h-7.163q-1.023 2.729-3.411 4.093l-4.775 2.729q-2.388 1.364-4.093 3.411-1.364 2.046-1.364 5.798-0.683-0.341-1.706-0.341-3.411 0-8.186 3.411-4.434 3.411-7.163 5.458-5.799 4.093-11.938 7.504-5.799 3.411-10.233 9.55-13.644 5.799-25.923 13.644-12.279 7.504-26.605 11.938-5.458 5.799-12.962 9.21-7.162 3.069-13.984 6.822v1.023q0 2.729 2.046 5.457 2.047 2.388 4.776 4.434 2.728 1.706 5.798 2.388 3.411 0.682 5.799 0 6.821 6.14 15.69 9.892 8.868 3.752 18.419 6.822 9.55 3.069 18.76 6.48 9.209 3.411 17.054 8.528h8.187q7.845 6.821 18.419 10.232 10.915 3.411 20.806 6.14 4.093 3.752 10.233 5.799 6.481 1.705 12.279 1.705h2.047q1.364 0 2.387-0.341v0.682q0 1.706 1.024 2.388 1.023 0.341 2.046 0.682 1.365 0 2.388 0.682 1.364 0.341 2.046 1.365h3.411q7.163 0 13.644 3.069 6.481 2.729 13.644 2.729 3.07 0 4.775-0.682 2.047 0.682 3.07 2.729 1.023 2.046 2.729 3.411 2.387-0.342 4.434-0.683 2.046 0 4.093 0 7.504 0 13.985 1.706 6.48 1.705 13.302 5.116 10.915-4.775 21.489-7.845t22.512-3.07v0.682q0 4.094 2.047 7.504 2.387 3.752 4.093 7.504zm-130.64-272.19q0-4.093-1.706-6.481-1.364-2.387-3.752-4.093-2.388-2.046-5.116-3.752-2.388-1.705-4.434-4.434-8.869-2.729-17.396-6.139-8.527-3.411-17.396-5.799-4.434-1.023-8.868-1.706-4.434-1.023-8.869-1.023h-7.504q-2.046-0.341-4.434-0.682-2.046-0.682-4.093-1.023-4.775-0.682-9.55-1.024-4.435-0.341-9.21-0.341-8.868 0-17.737 0.683l-17.737 1.364q-3.752 0.341-7.845 0.341t-7.504 0.682q-1.705 0.341-4.775 1.706-3.07 1.023-6.481 2.387-3.411 1.024-6.822 2.388-3.069 1.364-5.457 2.047 0.341 2.387 0.341 4.775v4.434q0 5.116-0.341 10.233-0.341 5.116-1.364 10.233-0.341 2.046-1.024 4.093-0.682 2.046-1.023 4.093-0.682 3.07-0.682 6.822v6.48q-0.682 7.845-1.023 15.349t-1.024 15.35q-2.046 22.512-4.434 44.683-2.046 22.171-2.729 44.683 11.256-2.388 21.489-7.163 10.233-4.776 20.125-10.233 9.891-5.799 19.783-11.256 9.892-5.458 20.807-9.21 2.728-3.752 6.48-6.139 4.093-2.388 6.822-6.14 3.411 0 5.117-1.364 1.705-1.706 4.434-2.388 16.372-14.326 33.427-26.946 17.054-12.621 32.745-26.946 1.364-4.776 4.434-9.21 3.411-4.775 6.48-9.55 3.07-4.776 5.458-9.551t2.388-10.233z"/>
                            <path d="m-23256 39282q-2.728 1.706-5.798 2.047t-6.481 1.023q-3.07 0.341-5.798 1.364-2.729 1.024-4.094 3.752-3.41-3.41-7.504-5.798-4.093-2.388-8.186-5.117-3.411 1.024-6.822 2.729-3.411 1.706-6.821 1.706-2.388 0-4.776-1.706-2.728 2.047-6.48 3.411-3.411 1.023-7.504 2.047-3.753 1.023-7.163 2.728-3.07 1.706-4.435 5.117-0.682-1.706-3.411-1.023-2.387 0.682-2.728-1.706-10.915 3.752-22.171 6.481t-22.512 5.798q-11.256 3.07-22.171 6.822t-21.148 9.21q-0.341 0.341-0.341 1.023 0 3.411 1.023 6.481 1.024 3.07 1.706 5.798-6.14 20.807-8.187 42.296-2.046 21.488-5.457 42.295v1.364q0 1.706 1.364 2.729 1.365 0.682 1.365 2.729l-0.341 0.682q-1.706 1.023-2.388 3.07-0.682 1.705-0.682 3.752 0 1.364 0.682 4.093-5.799 19.442-7.845 39.567-1.706 20.124-4.434 40.248l-3.07 22.513q-0.682 2.046-1.364 4.093-0.342 1.705-0.342 3.752 0 10.915 1.365 21.488 1.705 10.233 1.023 21.148 3.07 4.775 3.07 9.21 0 1.705-0.341 3.411 0 1.705-0.341 3.41 4.434 4.435 10.232 6.14 6.14 2.047 10.915 6.14v1.364q0 3.411-1.023 6.481-1.023 3.411-1.705 6.822-0.683 2.728-1.706 7.845-0.682 5.116-2.046 6.822-1.706 2.387-5.117 4.093-3.07 2.046-6.139 2.046-1.024 0-3.07-1.023-1.706-1.023-2.729-1.705-1.705 0-4.434 1.705t-5.458 1.705q-1.364 0-2.387-0.341-1.024 0-2.388-0.682-1.364-3.411-4.093-6.139-2.388-2.388-5.799-4.776 0.342-4.775-1.705-7.163-2.047-2.387-4.093-6.139-0.682-4.776-1.364-10.915-0.342-6.14-5.117-8.869 1.706-2.387 1.706-6.48 0-1.706-0.683-3.752-0.341-2.047-2.046-3.07v-0.682q-0.341-1.706 1.023-2.388 1.706-1.023 1.706-2.729v-1.364q-2.388-10.915-2.388-22.853 0-11.256 0.682-22.171 0.682-11.256 0-22.512 2.047-1.706 3.07-5.458 1.364-3.752 2.047-8.186 0.682-4.434 0.682-8.527 0.341-4.434 0.682-7.163 1.705-19.442 5.457-38.203 3.752-19.101 4.435-38.884 1.705-2.729 2.046-7.163t0.341-9.209q0-5.117 0.682-9.892 0.683-4.775 2.729-8.186 0-9.551 1.706-19.101 1.705-9.892 1.705-19.784 0-4.775-1.023-9.891-3.411-1.365-6.14-1.365-3.752 0-7.845 1.706-3.752 1.364-5.457 4.434-7.504 0.341-14.667 2.388-7.163 2.046-14.326 2.046h-3.411q-1.365 0-3.07-0.341-2.388 1.023-5.116 1.705-2.388 0.683-2.047 4.094-10.574 1.023-20.807 4.434-9.891 3.411-19.783 7.504-9.892 3.752-19.783 7.163-10.233 3.411-20.807 4.434-3.752 1.705-4.775 7.163-7.504-0.682-12.62-3.752-5.117-3.07-11.939-5.799-2.046-7.163-2.046-13.643 0-8.528 3.411-16.373t10.915-11.597q1.705 0.341 3.069 0.682 1.365 0 3.07 0 5.458 0 10.915-2.046 5.458-2.047 11.256-2.047 1.706 0 3.752 1.023 2.388-1.364 6.14-2.046 3.411-1.023 6.481-1.706 3.411-1.023 6.139-2.728 2.729-1.706 3.411-4.776 1.706 1.365 3.752 1.706 2.047 0.341 4.093 0.341 4.435 0 9.21-1.706 4.775-1.705 7.504-5.457 2.387 2.729 6.822 2.729 4.775 0 9.209-2.388 4.775-2.729 9.21-2.729 3.411 0 5.116 2.388 3.752-3.07 8.868-4.775 5.117-1.706 10.233-3.07 5.458-1.364 9.892-3.07 4.775-1.705 7.504-4.775 1.705 0.341 5.457 0.341 5.799 0 10.915-1.364 5.458-1.706 10.915-3.07l7.163-0.682q2.729-0.342 4.775-1.706 2.388-1.364 4.776-2.388 2.387-1.023 4.775-1.705 2.729-0.682 6.481-0.341 8.186-4.434 17.395-6.822 9.21-2.388 18.76-4.093 9.551-2.047 18.76-4.434 9.21-2.729 17.396-7.845h1.023q6.822 0 13.303-2.388 6.822-2.388 12.62-6.481 1.024 0.341 2.047 0.341h2.388q9.55 0 18.419-2.728 9.209-2.729 19.101-2.729 5.798 0 9.209 1.705 3.411 1.365 6.14 3.752 2.729 2.047 5.798 4.093 3.07 2.047 7.845 3.07 3.07 5.799 3.07 12.621 0 6.48 0.341 13.302z"/>
                            </g>
                            </g>
                        </svg>
                    </div>
                <div class="font-subheading">The easiest way to send messages and settle payments across devices</div>
                <div class="row">
                <a id=github class="icon-button" target="_blank" href="" title="Snapdrop on Github" rel="noreferrer">
                    <svg class="icon">
                        <use xlink:href="#github-icon" />
                    </svg>
                </a>
                <a id=twitter class="icon-button" target="_blank" href="" title="Tweet about Snapdrop" rel="noreferrer">
                    <svg class="icon">
                        <use xlink:href="#twitter-icon" />
                    </svg>
                </a>
                <a id=whirled class="icon-button" target="_blank" href="" title="Help cover the server costs!" rel="noreferrer">
                <svg class="icon">
                    <use xlink:href="#monetarization" />
                </svg>
                </a>
                <a id=help class="icon-button" target="_blank" href="" title="Frequently asked questions" rel="noreferrer">
                    <svg class="icon">
                        <use xlink:href="#help-outline" />
                    </svg>
                </a>
            </div>
                <br></br>
                    <div class="support-panel">
                        <h2 class="support-title" style="font-style: italic; padding-top:30px">for the community</h2>
                        <h2 class="support-title" style="font-style: italic; margin-top:-20px"> by the community</h2>
                    <div style="padding-top:5px">@whirledlabs | @interc0der</div>
                </div>
            </section>
            <div id="info-animation"></div>`
        }
    
        constructor() {
            //super(about);
            this._aboutDom();
            Events.on('about-close', e => this._onAboutClose(e.detail));
            $('info-button').addEventListener("click", e => this._onClose());
            //$('github').addEventListener("click", e => this._onGithub());
            //$('twitter').addEventListener("click", e => this._onTwitter());
            $('help').addEventListener("click", e => this._onHelp());
            $('whirled').addEventListener("click", e => this._onWhirled());
            //$('linus').addEventListener("click", e => this._onLinus());
            //$('intercoder').addEventListener("click", e => this._onIntercoder());
        }
    
        _aboutDom() {
            const el = document.createElement('x-about');
            el.id = "about";
            el.setAttribute("class", "full center column-alt");

            el.innerHTML = this.about_html();
            $$('x-about-container').appendChild(el);
            const background_wrapper = document.createElement('x-wrapper-about-background');
            const background = document.createElement('x-about-background');

            $$('x-about-container').appendChild(background_wrapper);
            $$('x-wrapper-about-background').appendChild(background);
        }

        _onClose() {
            //console.log(About);
            //About.destroy();
            $$('x-about-container').innerHTML = '';
            Events.fire('info-anime-stop');
        }
    }

//Trigger icon funaction and URLs

$('person').addEventListener('click', e => {Events.fire("alias",{from: "icon", fire: undefined})});
$('add').addEventListener('click', e => {Events.fire("selector", {from: "icon", fire: undefined, type: "signIn"})});
$('qr-button').addEventListener('click', e => {Events.fire("share", {from: "icon", fire: undefined, type: "share"})});


//Trigger background animations

const info_button = $('about-button');
info_button.addEventListener("click", () => {
    new About;
    Events.fire('info-anime');
});
//------------

Notifications.PERMISSION_ERROR = `
Notifications permission has been blocked
as the user has dismissed the permission prompt several times.
This can be reset in Page Info
which can be accessed by clicking the lock icon next to the URL.`;

document.body.onclick = e => { // safari hack to fix audio
    document.body.onclick = null;
    if (!(/.*Version.*Safari.*/.test(navigator.userAgent))) return;
    blop.play();
}

class Interport {
    constructor() {
            const roomDialog = new RoomDialog();
            const me = new Me();

            if(navigator.userAgent.indexOf("xumm") !== -1 ) {
                console.log("This is an xApp");
                xApp_init();
                sessionToggle.method = 'xApp';
            };

            const sendTextDialog = new SendTextDialog();
            const receiveTextDialog = new ReceiveTextDialog();

            const sendPayDialog = new SendPayDialog();
            const receivePayDialog = new ReceivePayDialog();

            const selectDialog = new SelectDialog(); 
            const addWalletDialog = new AddWalletDialog();
            const appSignDialog = new AppSignDialog();
            const aliasDialog = new AliasDialog();
            const signDialog = new SignDialog();

            const sentPayDialog = new SentPayDialog();

            const generalDialog = new GeneralDialog();

            const qrDialog = new QRDialog();

            const sendGroupTextDialog = new SendGroupTextDialog;
            const sendGroupPayDialog = new SendGroupPayDialog;
            const sentPayGroupDialog = new SentPayGroupDialog

            const createdRoom = new CreatedRoomDialog();
            const addRoom = new AddRoomDialog();

            const toast = new Toast();
            const notifications = new Notifications();
            const networkStatusUI = new NetworkStatusUI();
            const webShareTargetUI = new WebShareTargetUI();

            const server = new ServerConnection();
            const peers = new PeersManager(server);
            const peersUI = new PeersUI();
            const userUI = new UserUI();

            const xapp = new xApp();

            if(sessionToggle.method == 'xApp'){
                $('add').setAttribute('hidden',true);}
    }
}

Events.on('load', async() => {

    const urlParams = new URLSearchParams(window.location.search);
    const roomID = urlParams.get('id') || '';

    const cookies = "roomId="+roomID;
    document.cookie = cookies;
    
    console.log(roomID);

    if (roomID != '') {

        const roomOptions = {method: 'POST',headers: {'Content-Type': 'application/json'},body: JSON.stringify({type: "setRoom",roomId : roomID})};

        const room = await fetch('/init', roomOptions)    
                    .then(response =>  response.json())
                    .then(res => { console.log(res)})


        const headerInfo = $('roomHeader');
        headerInfo.innerText = `PortID: ${roomID}`;

        const interport = new Interport();
        Events.fire('anime')
    } else {    
        const interport = new Interport();
        Events.fire('room')
    }
});