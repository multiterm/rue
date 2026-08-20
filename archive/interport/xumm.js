const {XummSdk} = require('xumm-sdk');
require('dotenv').config();

const Sdk = new XummSdk (process.env.APIKEY, process.env.APISECRET);


      //Open up channel with the user. Fetch and trigger a scannable QR code for signing
        const signIn = async () => {
          const request = {
            "TransactionType": "SignIn",
          };
          const payload = await Sdk.payload.create(request, true)

          init_packet = {
            url: payload.next.always,
            qrcode: payload.refs.qr_png,
            websocket:payload.refs.websocket_status,
            uuid:payload.uuid}

            return init_packet;
      };

      //Server side listening to the siqn request. Population data once the user information on sign

      async function subscribe(data) {
        const subscribe = await Sdk.payload.subscribe(data.uuid, event => {

          if(Object.keys(event.data).indexOf('signed') > -1) {
            return event.data;
          } else {
            console.log(event.data);
          }
        })

        const resolvedData = await subscribe.resolved;

        if(resolvedData.signed == false) {
          console.log("Signed request rejected")
        } else {
          console.log("Signed request signed");
          const result = await Sdk.payload.get(resolvedData.payload_uuidv4);

          const resolved = {status: "This subscription is resolved",
          }

          return resolved;         
        }
        //});
      };

      //Getting public address after the user signs in

      async function getAddress(uuid) {
        const result = await Sdk.payload.get(uuid);
        return {key:result.response.account, node:result.response.dispatched_nodetype};  
        }

      async function getUserToken(data) {
        const result = await Sdk.payload.get(data.uuid);
        data.userToken = result;
        console.log(data);
        return data;  
        }

      //Back-end transactions preparation and push notification

      async function tx(data) {

        console.log(data.user);

          const request =  {
            txjson: {
              "TransactionType" : 'Payment',
              "Account" : String(data.account),
              "Destination" : String(data.destination),
              "Amount": String(data.amount*1000000)
            },
            "user_token": String(data.user)
          }
          const payload = await Sdk.payload.create(request, true)
          console.log(payload);

          console.log("UUID: ", payload.uuid);
          console.log("websocket: ",  payload.refs.websocket_status);
          console.log("Pushed: ",  payload.pushed);

          send_packet = {
            url: payload.next.no_push_msg_received,
            qrcode: payload.refs.qr_png,
            websocket:payload.refs.websocket_status,
            uuid:payload.uuid,
            amount: data.amount
          }

            return send_packet;
      };

      async function getHash(uuid) {
        const result = await Sdk.payload.get(uuid);
        return result.response.txid;  
        }

      module.exports = {signIn, subscribe, getAddress, tx, getUserToken, getHash}
