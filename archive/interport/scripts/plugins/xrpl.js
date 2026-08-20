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
