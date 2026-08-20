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