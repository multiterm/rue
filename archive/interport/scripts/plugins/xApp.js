//const {injectHTML} = require("./inject.js");

async function xApp_init() {

    const urlParams = new URLSearchParams(window.location.search);
    const oneTimeToken = urlParams.get('xAppToken') || '';

    const auth = await getTokenData(oneTimeToken);

    console.log("This is the auth response", auth);

    if ( auth.style == "LIGHT" ) {
        console.log("setting light theme")
        document.body.classList.toggle('light-theme');
        localStorage.setItem('theme', 'light');
    } else {
        console.log("setting dark theme")
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('theme', 'dark');
    }

    if ( auth.nodetype == "MAINNET" ) {
        console.log("This wallet is on the mainnet");
        //setTimeout(closeXapp(), 5000); // Closing out of xApp
        setTimeout(
            Events.fire('message', {title: "Oops!", message: "Testport only compatible with accounts on the testnet. You will only be able to send messages :P \r\n\r\n To enable payments, close the xApp and switch to a testnet account."})
             , 2000)
    } else {
    //const style = auth.style;
    //const nodetype = auth.nodetype;
    //const accounttype = auth.accounttype;
    //const accountaccess = auth.accountaccess;
        Events.fire('user-token', auth.user);
        Events.fire('xApp-wallet', auth.account);
    }
    /*
    const el = document.createElement('inject');
    el.innerHTML = injectHTML();
    $$('body').appendChild(el);
    */

}

class xApp {
    constructor() {
        Events.on("display-set", e => this._onDisplayName(e.detail));
        Events.on("xApp-wallet", e => this._onChange(e.detail));
    }

    _onDisplayName(message) {
        this.me = message
        console.log("This is the me info", this.me);
    }

    async _onChange(key) {

        this.Key = key;
        Events.fire("change-wallet", this.Key);

        console.log(this.me);

        this.me.wallet = this.Key;        
        this.me.deviceName = "xApp";

        Events.fire("change-device", this.me.deviceName);

        const peers = document.querySelectorAll('x-peer');

        this.room = [];

        for (let i=0; i<peers.length; i++) {
            const info = JSON.parse((peers[i]).getAttribute('data-peer'))
            this.room.push(info);
        };

        this.room.map(peer => {Events.fire('peer-change', {to:peer.id, from: this.me})})
    }

}

//Open sign request
async function xApp_payload(data) {

    console.log("Constructing Option")

    const options = {method: 'POST',headers: {'Content-Type': 'application/json'},body: JSON.stringify(data)};       

    const resp = await fetch('/send', options)           
        .then(response =>  response.json())
        .then(res => {return res})
        .catch(err => console.error('error:' + err));

        try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
                "command": "openSignRequest",
                "uuid": resp.uuid
            }))

            await status();

            const hashOptions = {method: 'POST',headers: {'Content-Type': 'application/json'},body: JSON.stringify({uuid : resp.uuid})};

            fetch('/get_hash', hashOptions)    
                .then(response =>  response.json())
                .then(res => {

                    Events.fire("tx-success", {id:res.id});
                    return;

                }).catch(err => console.error('error:' + err));
        } catch(e) {
                Events.fire('message', {title: "Oops!", message: "Payment aborted, try again"})
            }
        }



//Open muliple sign requests
async function xApp_groupPayload(data) {

    console.log("Constructing group payloads")

    const overall_result = [];

    for (let i = 0; i < data.id.length; i++) {
        
        const payload = {
                txjson: {
                  "TransactionType" : 'Payment',
                  "Account" : String(data.account),
                  "Destination" : String(data.destination[i]),
                  "Amount": String(data.amount*1000000)
                }
            }

        try {
            const result = await payload(payload);

            const packet = {
                status: "success",
                to: data.id[i],
                destination: data.destination[i],
                amount: data.amount,
                id: result.response.txid,
                recipientAlias: data.alias[i]
            }

            overall_result.push(packet);
            Events.fire('xumm-signed-groupie', packet);

        } catch (e) {

            const packet = {
                status: "fail",
                to: data.id[i],
                destination: data.destination[i],
                amount: data.amount,
                recipientAlias: data.alias[i]
            }

            overall_result.push(packet);
        }
    }

    Events.fire('xumm-sent-group', overall_result);

}


// --------------- xApp Plugin ----------------------// 

let tokenData
let jwt
let curatedAssets

const apiKey = "d9e07ce9-8a5b-4e74-8eff-823df09fffc9";
const apiEndPoint = `https://interport.whirled.io`;
//const apiEndPoint = ``;

const accessToken = () => {
    if(jwt) return jwt
    else {
        jwt = tokenData.token
        return jwt
    }
}

const headers = (getJWT) => {
    if(getJWT) return { headers: { 'x-api-key': apiKey } }
    else return { headers: { Authorization: accessToken(), 'x-api-key': apiKey } }
}

const getTokenData = async (ott) => {
    if(!tokenData) {
        try {
            const res = await axios.get(`${apiEndPoint}/xapp/ott/${ott}`, headers(true))
            tokenData = res.data
            jwt = res.data.token
            return tokenData
        } catch(e) {
            throw 'Error getting Token Data'
        }
    } else {
        return tokenData
    }    
}

const sendCommandtoXumm = (command) => {
    if (typeof window.ReactNativeWebView === 'undefined') throw new Error('This is not a react native webview')
    window.ReactNativeWebView.postMessage(JSON.stringify(command))
}

const openSignRequest = (uuid) => {
    try {
        sendCommandtoXumm({
            command: 'openSignRequest',
            uuid: uuid
        })
    } catch(e) {
        throw e
    }
}

const closeXapp = () => {
    try {
        sendCommandtoXumm({
            command: "close",
            refreshEvents: false
        })
    } catch(e) {
        throw e
    }
}

const openExternalBrowser = (url) => {
        try {
            sendCommandtoXumm({
                command: 'openBrowser',
                url: url
            })
        } catch(e) {   
            throw e               
        }
    };  


const openTxViewer = (tx, account) => {
    try {
        sendCommandtoXumm({
            command: 'txDetails',
            tx,
            account
        })
    } catch(e) {
        throw e
    }
}


const getCuratedAssets = async () => {
    if(curatedAssets && Object.keys(curatedAssets).length > 0 && curatedAssets.constructor === Object) return curatedAssets
    try {
        const res = await axios.get(`${apiEndPoint}/curated-assets`, headers())
        curatedAssets = res.data
        return curatedAssets
    } catch(e) {
        throw e
    }
}

const status = () => {
    return new Promise((resolve, reject) => {
        function message(event) {
            window.removeEventListener("message", message)
            document.removeEventListener("message", message)

            const data = JSON.parse(event.data)
            if(data.method !== 'payloadResolved') return reject('')
            if(data.reason === 'SIGNED') return resolve()
            else return reject('')
        }
        //iOS
        window.addEventListener('message', message)
        //Android
        document.addEventListener('message', message)
    })
}

const payload = async (payload) => {
    try {
        const res = await axios.post(`${apiEndPoint}/payload`, payload, headers())
        openSignRequest(res.data.uuid)
        await status()
        const result = await axios.get(`${apiEndPoint}/payload/${res.data.uuid}`, headers())
        return result
    } catch(e) {
        if (e === '') throw { msg: 'closed', error: false }
        throw e
    }
}

const event = async (payload, usertoken) => {
    try {
        const res = await axios.post(`${apiEndPoint}/payload`, payload, headers())
        openSignRequest(res.data.uuid)
        await status()
        const result = await axios.get(`${apiEndPoint}/payload/${res.data.uuid}`, headers())
        return result
    } catch(e) {
        if (e === '') throw { msg: 'closed', error: false }
        throw e
    }
}

const push = async (payload) => {
    try {
        const res = await axios.post(`${apiEndPoint}/payload`, payload, headers())
        openSignRequest(res.data.uuid)
        await status()
        const result = await axios.get(`${apiEndPoint}/payload/${res.data.uuid}`, headers())
        return result
    } catch(e) {
        if (e === '') throw { msg: 'closed', error: false }
        throw e
    }
}

const versionCheck = (v1, v2) => {
    var v1parts = v1.split('.');
    var v2parts = v2.split('.');

    // First, validate both numbers are true version numbers
    function validateParts(parts) {
        for (var i = 0; i < parts.length; ++i) {
            if (!/^\d+$/.test(parts[i])) {
                return false;
            }
        }
        return true;
    }
    if (!validateParts(v1parts) || !validateParts(v2parts)) {
        return NaN;
    }

    for (var i = 0; i < v1parts.length; ++i) {
        if (v2parts.length === i) {
            return 1;
        }

        if (v1parts[i] === v2parts[i]) {
            continue;
        }
        if (v1parts[i] > v2parts[i]) {
            return 1;
        }
        return -1;
    }

    if (v1parts.length != v2parts.length) {
        return -1;
    }

    return 0;
}