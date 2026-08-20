//const ƨ =  require('sologenic-xrpl-stream-js');

const solo_signIn = async () => {

		const sologenic = await new ƨ.SologenicTxHandler(
			// RippleAPI Options
			{
				server: 'wss://testnet.xrpl-labs.com', // Kudos to Wietse Wind
			},
			// Sologenic Options
			{
				clearCache: true,
				queueType: 'hash',
				hash: {},
			}
		)

        sologenic.connect().then(async () => {

            console.log("connected")

            await sologenic.setSigningMechanism(
                new ƨ.SoloWalletSigner({
                    server: 'https://api.sologenic.org/api/v1/',
                    container_id: 'qr_code_container',
                    fallback_container_id: 'fallback_container'
                })
            );

            console.log(ƨ.SoloWalletSigner)

            const { address } = await sologenic.connectSigner();
            console.log(address)
        });

    }
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
// ================= configuration & Global constant  ==================

var CLIENT_VERSION = "rm-1.2.4"
var INSERT_CLIENT_INFO = true;


var SERVERS_MAINNET = [
    {
        host:    's1.ripple.com/', 
        port:    443, 
        secure:  true, 
        primary: true
    },
    {
        host:    's-east.ripple.com/', 
        port:    443, 
        secure:  true
    },
    {
        host:    's-west.ripple.com/', 
        port:    443,
        secure:  true
    },
    {
        host:    'wss://xrplcluster.com', 
        port:    '',
        secure:  true
    },
    {
        host:    'mainnet.sologenic.com', 
        port:    '',
        secure:  false
    }        
 ];

var SERVERS_TESTNET = [
    {
        host: 's.altnet.rippletest.net/', 
        port: 51233, 
        secure: true
    },
    {
        host: 'wss://testnet.xrpl-labs.com', 
        port: '', 
        secure: true
    },
    {
        host: 'testnet.sologenic.com', 
        port: '', 
        secure: false
    }
];

var DEV_TESTNET = [
    {
        host: 'wss://hooks-testnet.xrpl-labs.com', 
        port: '', 
        secure: true
    },
];

var GATEWAYS = [
    {
        name: "BitStamp",
        address: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
        currencies: ['USD', 'BTC'] 
    },
    {
        name: "SnapSwap",
        address: "rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q",
        currencies: ['USD', 'BTC', 'EUR'] 
    },
    {
        name: "RippleChina",
        address: "razqQKzJRdB4UxFPWf5NEpEG3WMkmwgcXA",
        currencies: ['CNY', 'BTC', 'LTC']   
    },
    {
        name: "RippleCN",
        address: "rnuF96W4SZoCJmbHYBFoJZpR8eCaxNvekK",
        currencies: ['CNY', 'BTC']  
    },
    {
        name: "RippleFox",
        address: "rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y",
        currencies: ['CNY', 'FMM', 'STR', 'XLM']  
    },
    {
        name: "TheRock",
        address: "rLEsXccBGNR3UPuPu2hUXPjziKC3qKSBun",
        currencies: ['BTC', 'LTC','NMC', 'PPC', 'DOG', 'USD ', 'EUR', 'GBP']  
    },
    {
        name: "DividendRippler",
        address: "rfYv1TXnwgDDK4WQNbFALykYuEBnrR4pDX",
        currencies: ['BTC', 'LTC', 'NMC', 'TRC', 'STR']      
    },
    {
        name: "PayRoutes",
        address: "rNPRNzBB92BVpAhhZr4iXDTveCgV5Pofm9",
        currencies: ['USD', 'ILS', 'BTC', 'LTC', 'NMC', 'PPC']  
    },
    {
        name: "RippleUnion",
        address: "r3ADD8kXSUKHd6zTCKfnKT3zV9EZHjzp1S",
        currencies: ['CAD']    
    },
    {
        name: "Bitso",
        address: "rG6FZ31hDHN1K5Dkbma3PSB5uVCuVVRzfn",
        currencies: ['BTC', 'MXN']      
    },
    {
        name: "RippleTradeJapan",
        address: "rMAz5ZnK73nyNUL4foAvaxdreczCkG3vA6",
        currencies: ['JPY']      
    },
    {
        name: "RippleExchangeTokyo",
        address: "r9ZFPSb1TFdnJwbTMYHvVwFK1bQPUCVNfJ",
        currencies: ['JPY']
    },
    {
        name: "DigitalGateJP",
        address: "rJRi8WW24gt9X85PHAxfWNPCizMMhqUQwg",
        currencies: ['JPY'] 
    },
    {
        name: "TokyoJPY",
        address: "r94s8px6kSw1uZ1MV98dhSRTvc6VMPoPcN",
        currencies: ['JPY']  
    },
    {
        name: "Ripula",
        address: "rBycsjqxD8RVZP5zrrndiVtJwht7Z457A8",
        currencies: ['BTC', 'EUR', 'GBP', 'USD']  
    },     
    {
        name: "Gatehub",
        address: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq",
        currencies: ['EUR', 'USD']  
    },
    {
        name: "GatehubFifthBTC",
        address: "rchGBxcD1A1C2tdxF6papQYZ8kjRKMYcL",
        currencies: ['BTC']  
    },
    {
        name: "GatehubFifthETH",
        address: "rcA8X3TVMST1n3CJeAdGk1RdRCHii7N2h",
        currencies: ['ETH']  
    },
    {
        name: "GatehubFifthETC",
        address: "rDAN8tzydyNfnNf2bfUQY6iR96UbpvNsze",
        currencies: ['ETC']  
    },
    {
        name: "GatehubFifthREP",
        address: "rckzVpTnKpP4TJ1puQe827bV3X4oYtdTP",
        currencies: ['REP']  
    },
    {
        name: "BPG",
        address: "rcoef87SYMJ58NAFx7fNM5frVknmvHsvJ",
        currencies: ['XAU']  
    },
    {
        name: "Bluzelle",
        address: "raBDVR7JFq3Yho2jf7mcx36sjTwpRJJrGU",
        currencies: ['CAD']  
    },
    {
        name: "eXRP",
        address: "rPxU6acYni7FcXzPCMeaPSwKcuS2GTtNVN",
        currencies: ['KRW']    
    },
    {
        name: "Rippex",
        address: "rfNZPxoZ5Uaamdp339U9dCLWz2T73nZJZH",
        currencies: ['BRL']  
    },
    {
        name: "RippexBridge",
        address: "rKxKhXZCeSDsbkyB8DVgxpjy5AHubFkMFe",
        currencies: ['BTC']  
    },
    {
        name: "MrRipple",
        address: "rB3gZey7VWHYRqJHLoHDEJXJ2pEPNieKiS",
        currencies: ['JPY', 'USD', 'BTC', 'LTC', 'DOG', 'STR']
    },
    {
        name: "Steemiex",
        address: "rKYyUDK7N4Wd685xjfMeXM9G8xEe5ciVkC",
        currencies: ['STM', 'SBD']
    },
    {
        name: "Sologenic",
        address: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
        currencies: ['534F4C4F00000000000000000000000000000000' /*SOLO*/]
    },
    ];

var TRADE_PAIRS = [
'USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B/XRP',
'BTC.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B/XRP',
'CNY.rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y/XRP',
'JPY.r94s8px6kSw1uZ1MV98dhSRTvc6VMPoPcN/XRP',
'KRW.rPxU6acYni7FcXzPCMeaPSwKcuS2GTtNVN/XRP',
'BRL.rfNZPxoZ5Uaamdp339U9dCLWz2T73nZJZH/XRP',
'MXN.rG6FZ31hDHN1K5Dkbma3PSB5uVCuVVRzfn/XRP',
'EUR.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq/XRP',
'ETH.rcA8X3TVMST1n3CJeAdGk1RdRCHii7N2h/XRP',
'STM.rKYyUDK7N4Wd685xjfMeXM9G8xEe5ciVkC/XRP',
]

var GATEWAYS_TEST = [
    {
        name: "GateOne",
        address: "r9U9DDht72oMx7nrqsS7uELXNvfsYL4USm",
        currencies: ['USD', 'BTC'] 
    },
    {
        name: "GateTwo",
        address: "rH6C28kDJURagNz1Mt6oX9PEyFtJqxyTwo",
        currencies: ['CNY', 'JPY'] 
    },
    {
        name: "Sologenic",
        address: "rMiTTf8TA9co9Pmzuzy7bVBr1mTwXzmpyU",
        currencies: ['SOLO'] 
    },
    ];

var TRADE_PAIRS_TEST = [
'USD.r9U9DDht72oMx7nrqsS7uELXNvfsYL4USm/XRP',
'BTC.r9U9DDht72oMx7nrqsS7uELXNvfsYL4USm/XRP',
'CNY.rH6C28kDJURagNz1Mt6oX9PEyFtJqxyTwo/XRP',
'JPY.rH6C28kDJURagNz1Mt6oX9PEyFtJqxyTwo/XRP',
'BTC.r9U9DDht72oMx7nrqsS7uELXNvfsYL4USm/USD.r9U9DDht72oMx7nrqsS7uELXNvfsYL4USm',
'USD.r9U9DDht72oMx7nrqsS7uELXNvfsYL4USm/CNY.rH6C28kDJURagNz1Mt6oX9PEyFtJqxyTwo',
'USD.r9U9DDht72oMx7nrqsS7uELXNvfsYL4USm/JPY.rH6C28kDJURagNz1Mt6oX9PEyFtJqxyTwo',
]    

/*
var DEFAULT = {
    slipage: SLIPAGE,
    max_fee: 120,
    fee_cushion: 1.2,
    orderbook_limit: 50,
    last_ledger_offset: 3,
    servers: SERVERS_MAINNET,
    gateways: GATEWAYS,
    tradepairs: TRADE_PAIRS,
    servers_test: SERVERS_TESTNET,
    gateways_test: GATEWAYS_TEST,
    tradepairs_test: TRADE_PAIRS_TEST,
    contacts: [],
    contacts_test: []
  }
*/


// ================= Functions  ==================

testnet_servers = [];

SERVERS_TESTNET.forEach(server => {
        if( server.secure == true ) {
            testnet_servers.push(server.host+server.port);
        } else {
            //Do nothing
        }
    });

    console.log(testnet_servers);

const {XrplClient} = require('xrpl-client')
const lib = require("xrpl-accountlib")

const client = new XrplClient(testnet_servers,{assumeOfflineAfterSeconds:15,maxConnectionAttmpts:4,connectionAtemptTimeoutSeconds:4});

//validating address for manual input

function validate() {

    client.ready().then(() => {

    const publicKey = {};
    publicKey.address = $('addressInput').innerText;
    const key = publicKey.address.replace(/\n/g, '')

      client.send({
        command: "account_info",
        account: key,
        strict: "true",
        ledger_index: "current",
        queue: "true"

    }).then((x) => {
        if (x.status !== "error" ){ 
            $('add-button').removeAttribute('disabled');
        } else {
            $('add-button').setAttribute('disabled', true);
            return;
        }
    }).catch((e) => {
        console.log("error", e)
            })
    })
}

//Preparing transaction

async function prepTx(account, destination, amount) {

    Events.fire('working', {title: "Preparing Transaction...", message: "Working very hard. Give me a second :P"});

    const state = await client.getState();

    if(state.online != true) {
        return await client.reinstate()};
       
    const { account_data } = await client.send({
        command: "account_info",
        account: account,
    });

    // Wait until we know what the current ledger index is
    //await client.ready();

    const LastLedgerSequence = client.getState().ledger.last + 40; // Expect finality in max. 2 ledgers

    if (isNaN(amount) || amount < 0 ) {
        Events.fire('message', {title: "Oops!", message: "Must input a valid number greater than zero"})
        return;
    }

    const prepTx = 
        {
        TransactionType: "Payment",
        Account: account,
        Destination: destination,
        Amount: String(amount*1000000),
        Sequence: account_data.Sequence,
        Fee: String(12),
        LastLedgerSequence,
        }
        
        Events.fire('message-close');
        Events.fire("tx-prepared",prepTx)
}

async function sendTx(prepTx, secret) {

    Events.fire('working', {title: "Processing payment...", message: "Working very hard. Give me a second :P"});

    const state = await client.getState();

    if(state.online != true) {
        return await client.reinstate()};
       

    //Verify secret correlates to original account address

    const accountObj = lib.derive.familySeed(secret);

    if ( accountObj.address == undefined | null ) {
        Events.fire('message', {title: "Oops!", message: "Secret does not exist. Make sure to input family seed secret key"});
    }

    if ( accountObj.address !== prepTx.Account ) {

        Events.fire('message', {title: "Oops!", message: "Account address and secret key do not match"});

    } else {
        console.log("account and secret match")
        const { id, signedTransaction } = lib.sign(prepTx, accountObj);

        client
            .send({ command: "subscribe", accounts: [accountObj.address] });

        client
            .send({ command: "submit", tx_blob: signedTransaction })
            .then(({ accepted, engine_result }) =>
            console.log("Transaction sent:", accepted, engine_result)
        ).catch((e) => {
            Events.fire('message', {title: "Oops!", message: "Signed transaction did not submit to ledger. Payment aborted."})
        });

        client
            .on("transaction",({ transaction, meta, ledger_index, engine_result }) => {
                if (transaction.hash === id) {

                    const packet = {
                        destination: transaction.Destination,
                        amount: transaction.Amount/1000000,
                        from: transaction.Account,
                        id: transaction.hash
                    }
                    
                    Events.fire("tx-success", packet)
                    //client.close();
                }
            }
        );

        client
            .on("ledger", ({ ledger_index }) => {
                if (ledger_index > LastLedgerSequence) {
                console.log(
                    "Past last ledger & transaction not seen. Transaction failed"
                );

                Events.fire('message', {title: "Oops!", message: "Past last ledger & transaction not seen. Transaction failed"})

                //client.close();
            }
        });

    }
};

async function groupPrepTx(account, destination, amount, id, alias) {

    Events.fire('working', {title: "Preparing Transaction...", message: "Working very hard. Give me a second :P"});

    const state = await client.getState();

    if(state.online != true) {
        return await client.reinstate()};

    //Verify sending account has enough to cover payment channel
    const { account_data } = await client.send({
        command: "account_info",
        account: account,
    });

    if (isNaN(amount) || amount < 0 ) {
        Events.fire('message', {title: "Oops!", message: "Must input a valid number greater than zero"})
        return;
    }

    console.log(`Account balance (XRP) ${(account_data.Balance)/1000000}`);

        if ( (account_data.Balance)/1000000 < destination.length*amount ) {

            Events.fire('message', {title: "Oops!", message: "It appears that the sending account has insufficient funds for cover group payment"})
            
        } else {

        const prepArray = [];

        for (let i = 0; i< destination.length; i++) {

            //client.ready().then( async () => {

            // Wait until we know what the current ledger index is
            //await client.ready();

            const LastLedgerSequence = client.getState().ledger.last + 40; // Expect finality in max. 2 ledgers

            const prepTx = 
                    {
                    TransactionType: "Payment",
                    Account: account,
                    Destination: destination[i],
                    Amount: String(amount*1000000),
                    Sequence: account_data.Sequence + i,
                    Fee: String(12),
                    LastLedgerSequence,
                    }

                    prepArray.push({tx:prepTx,id:id[i],alias:alias[i]})

                }

                if(destination.length = prepArray.length) {

                    Events.fire("grouptx-prepared",prepArray)
                    Events.fire('message-close');
                }

            }
}

async function groupSendTx(prepTx, secret, peerId, alias) {

    const overall_packet = [];

    Events.fire('working', {title: "Processing payment...", message: "Working very hard. Give me a second :P"});

    //Verify secret correlates to original account address

    const accountObj = lib.derive.familySeed(secret);

    if ( accountObj.address == undefined | null ) {
        console.log("Oops, secret does not exist. Make sure to input family seed secret key")
        Events.fire("message", { message: "Oops, secret does not exist. Make sure to input family seed secret key" }  )
    }

    if ( accountObj.address !== prepTx[0].Account ) {
        console.log("Oops, Account address and secret key do not match")
        Events.fire("message", { message: "Oops, Account address and secret key do not match" }  )

    } else {

        for (let i = 0; i < prepTx.length; i++) {
        
            const { id, signedTransaction } = lib.sign(prepTx[i], accountObj);

            console.log("Transaction hash:", id);
            console.log("signed Transaction:", signedTransaction);
            submit (signedTransaction, peerId[i], alias[i] );
            subscribe_listen(accountObj, id, prepTx, peerId[i], alias[i]);
            const result = await callback();

            overall_packet.push(result);
            console.log(overall_packet);
            }

            if(overall_packet.length = prepTx.length) {
                Events.fire("message-close")
                Events.fire('group-pay-sent', overall_packet)
        }
    }
}

function subscribe_listen (accountObj, id, prepTx, peerId, alias) {

    client
        .send({ command: "subscribe", accounts: [accountObj.address] });
        console.log("Subsribed");

    client
        .on("transaction",({ transaction, meta, ledger_index, engine_result }) => {
            if (transaction.hash === id) {

                const data = {
                    to: peerId,
                    destination: transaction.Destination,
                    amount: transaction.Amount/1000000,
                    from: transaction.Account,
                    toAlias: alias,
                    id: id
                }

                Events.fire("grouptx-success", data);
                Events.fire('resolve',data)
            }
        }
    );

    client
        .on("ledger", ({ ledger_index }) => {
            if (ledger_index > LastLedgerSequence) {
            console.log(
                "Past last ledger & transaction not seen. Transaction failed"
            );
            
                const message = "Past last ledger & transaction not seen. Transaction failed" 
                Events.fire("tx-fail", { message, peerId, alias})
                Events.fire("message", { message: "Past last ledger & transaction not seen. Transaction failed" }  )

                //client.close();
                }
            })
        }


function submit(signedTx, peerId, alias) {

        client
            .send({ command: "submit", tx_blob: signedTx})
            .then(({ accepted, engine_result }) =>
                console.log("Transaction sent:", accepted, engine_result)
    ).catch((e) => {
        console.log("error");
        const message = "Past last ledger & transaction not seen. Transaction failed";
        Events.fire("tx-fail", { message, peerId, alias})
        Events.fire("message", { message: "Past last ledger & transaction not seen. Transaction failed" }  )
    })
}

async function xumm_init() {

    const xummApiKey = "d9e07ce9-8a5b-4e74-8eff-823df09fffc9";
    const endpoint = `https://interport.whirled.io/xumm/init`;
    //const endpoint = `/xumm/init`;

    const auth = await axios(endpoint, { headers: {'x-api-key':xummApiKey} })
    jwt = auth.data;
    }

async function xumm_payload(request) {

      const payload = await generic_payload(request);

      console.log("payload.." + payload)

      const packet = {
        url: payload.next.always,
        qrcode: payload.refs.qr_png,
        websocket:payload.refs.websocket_status,
        uuid:payload.uuid,
      }

      return packet;
}

async function xummGroupPayload(request, id, alias, destination, amount) {

        console.log("Constructing group payloads")

        if (isNaN(amount) || amount < 0 ) {
            Events.fire('message', {title: "Oops!", message: "Must input a valid number greater than zero"})
            return;
        }

        const overall_packet = [];

        for (let i = 0; i < request.length; i++) {

            const payload = await generic_payload(request[i]);
                
            const packet = {
                url: payload.next.always,
                qrcode: payload.refs.qr_png,
                websocket:payload.refs.websocket_status,
                uuid:payload.uuid,
                alias: alias[i],
                id: id[i],
                amount: amount,
                destination: destination[i]
            }

            overall_packet.push(packet);
            console.log(overall_packet);
        }

        
            return overall_packet;
    }


async function groupWebSocket(url,type) {

        const ws = new WebSocket(url);

        ws.onmessage = function(event) {
            const resp = JSON.parse(event.data);
            if(resp.signed == false) {
                Events.fire('message-close')
                Events.fire('message', {title: "Oops", message: "Sign rejected, try again :P"})
                Events.fire('reject');

            } else if(resp.signed == true) {

                    console.log("Signed")
                    ws.close();
                    Events.fire('resolve',{uuidPayload :resp.payload_uuidv4,uuidCall :resp.reference_call_uuidv4})

            } else if (Object.keys(resp).indexOf('opened') > -1){
                Events.fire('working', {title: "Processing...", message: "QR Code scanned, waiting for your approval :P"})
            }else {
                //wait for user to open or sign tx
            };
        }
}

async function callback (){ 
    return new Promise((resolve, reject) => {
        Events.on('resolve', (e) => {
            return resolve(e.detail)})
        Events.on('reject',  () => {
            return reject()})
    })
}


// --------------- xumm Plugin ----------------------// 


const generic_payload = async (payload) => {
    try {
        const res = await axios.post(`${apiEndPoint}/payload`, payload, headers())
        console.log(res.data)
        return res.data
    } catch(e) {
        if (e === '') throw { msg: 'closed', error: false }
        throw e
    }
}