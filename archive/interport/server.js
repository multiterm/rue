var process = require('process')
// Handle SIGINT
process.on('SIGINT', () => {
  console.info("SIGINT Received, exiting...")
  process.exit(0)
})

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.info("SIGTERM Received, exiting...")
  process.exit(0)
})

// Handle APP ERRORS
process.on('uncaughtException', (error, origin) => {
    console.log('----- Uncaught exception -----')
    console.log(error)
    console.log('----- Exception origin -----')
    console.log(origin)
})
process.on('unhandledRejection', (reason, promise) => {
    console.log('----- Unhandled Rejection at -----')
    console.log(promise)
    console.log('----- Reason -----')
    console.log(reason)
})

require('dotenv').config();
const express = require('express');
const http = require('http');
const app = express();
const port = process.env.PORT || 3000;
const publicRun = process.argv[2];
const xumm = require('./xumm.js');
const path = require('path')

const cors = require('cors');
const jwt = require('jsonwebtoken');
const { default: axios } = require('axios');
const helmet = require("helmet");


var forceSSL = function (req,res, next) {
    if (req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect([
            'https://', req.get('Host'), req.url
        ].join(''))
    } else { 
        return next();
    }
}

app.use(forceSSL);


const corsOptions = {
    origin: [`http://localhost:${port}`, '*','https://apps.xumm.dev', 'https://xapp.loca.lt', 'https://xumm.app/detect/xapp:whirled.port', '192.168.1.58:3003', '192.168.1.214:3003', 'https://interport.io', 'https://api.sologenic.org/api/v1/issuer/transactions', 'https://app-whirled-interport.herokuapp.com'],
    // methods: 'GET, POST, OPTIONS'
  }  


app.use('/', cors(corsOptions))
app.use(express.static(path.join(__dirname, 'client/build')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

var message, setRoomId


//Processing the wallet information 

app.use('/init', cors(corsOptions));
app.use('/init', express.json({limit:"1mb"}));

app.post('/init', async (req, res) => {
    console.log(req.body);

    switch (req.body.type) {
        case 'setRoom':
          message = "The room has been set";
          res.send({message: message});
          setRoomId = req.body.roomId;
          console.log(setRoomId);
          break;
        case 'setXumm':
            const about = await xumm.getAddress(req.body.uuidPayload)
            const user_token = await xumm.getUserToken(req.body.uuidPayload)
            message = "The key has been set";
            res.send({key:about.key, server:about.node, user: user_token});
            break;
        case 'setDevice':
            message = "The device has been set";
            res.send({message: message});
            setDevice = req.body.device;
            break;
        }
    });

//User opened webapp and requiring a XUMM qr code from backend
//QR presented and backend subscribe initiated
app.use('/qr', cors(corsOptions));
app.use('/qr', express.json({limit:"1mb"}));

app.post('/qr', (req, res) => {
    console.log(req.body);

    switch (req.body.type.method) {
        case 'xumm':
            xumm.signIn().then((data) => {
                res.send(data);
            });
        break;
        case 'solo':
        break;
    }
});

//Open routing for initializing push notification and signing transaction
//Provide a qr code for alternative signing
app.use('/send', cors(corsOptions));
app.use('/send', express.json({limit:"1mb"}));

app.post('/send', (req, res) => {
    console.log("Sending Payment..")
        xumm.tx(req.body).then((data) => {
        xumm.subscribe(data);
        return res.send(data);
        });
    });


app.use('/groupsend', cors(corsOptions));
app.use('/groupsend', express.json({limit:"1mb"}));

app.post('/groupsend', (req, res) => {
    console.log("Sending Payment..")
        xumm.grouptx(req.body).then((data) => {
        return res.send(data);
        });
    });


app.use('/get_hash', cors(corsOptions));
app.use('/get_hash', express.json({limit:"1mb"}));

app.post('/get_hash', async (req, res) => {
        const hash = await xumm.getHash(req.body.uuid);
        console.log("Logging the hash ", hash);
        const message = "The hash has been acquired";
        res.send({message: message, id : hash});
});

const server = http.createServer(app);
(!publicRun == "public") ? server.listen(port) : server.listen(port, '0.0.0.0');

const parser = require('ua-parser-js');
const { uniqueNamesGenerator, animals, colors } = require('unique-names-generator');

class PortServer {
    constructor() {
        const WebSocket = require('ws');
        this._wss = new WebSocket.Server({ server });
        this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));
        this._rooms = {};
        console.log('Interport is running on port', port);
    }

    _onConnection(peer) {
        this._joinRoom(peer);
        peer.socket.on('message', message => this._onMessage(peer, message));
        this._keepAlive(peer);

        // send displayName
        this._send(peer, {
            type: 'display-name',
            message: {
                id:peer.id,
                displayName: peer.name.displayName,
                deviceName: peer.name.deviceName,
                wallet: peer.name.wallet,
                color: peer.name.color
            }
        });
    }

    _onHeaders(headers, response) {
        if (response.headers.cookie && response.headers.cookie.indexOf('peerid=') > -1) return;
        response.peerId = Peer.uuid();
        headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=Strict; Secure");
    }

    _onMessage(sender, message) {
        // Try to parse message 
        try {
            message = JSON.parse(message);
        } catch (e) {
            return; // TODO: handle malformed JSON
        }

        //console.log("Logging message", message);

        switch (message.type) {
            case 'disconnect':   
            console.log('We are going to remove', sender.ip, sender.id);           
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
        }

        // relay message to recipient
        if (message.to && this._rooms[sender.ip]) {
            const recipientId = message.to; // TODO: sanitize
            const recipient = this._rooms[sender.ip][recipientId];
            delete message.to;
            // add sender id
            message.sender = sender.id;
            this._send(recipient, message);
            return;
        }
    }

    _joinRoom(peer) {

       console.log("Joined peer ip",peer.ip)
        // if room doesn't exist, create it
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }

        // notify all other peers
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // notify peer about the other peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.ip]) {
            otherPeers.push(this._rooms[peer.ip][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // add peer to room
        this._rooms[peer.ip][peer.id] = peer;
        //console.log("This is the room right now:", this._room[peer.ip])
    }

    _leaveRoom(peer) {

        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
        this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

        // delete the peer
        delete this._rooms[peer.ip][peer.id];

        peer.socket.terminate();

        //if room is empty, delete the room
        if (!Object.keys(this._rooms[peer.ip]).length) {
            delete this._rooms[peer.ip];
        } else {
            // notify all other peers
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
    }

    _send(peer, message) {
        if (!peer) return;
        if (this._wss.readyState !== this._wss.OPEN) return;
        message = JSON.stringify(message);
        peer.socket.send(message, error => '');
    }

    _keepAlive(peer) {
        this._cancelKeepAlive(peer);
        var timeout = 30000;
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }

        this._send(peer, { type: 'ping' });

        peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
    }

    _cancelKeepAlive(peer) {
        if (peer && peer.timerId) {
            clearTimeout(peer.timerId);
        }
    }
}

class Peer {

    constructor(socket, request) {
        // set socket
        this.socket = socket;

        // set remote ip
        this._setIP(request);

        // set peer id
        this._setPeerId(request)
        // is WebRTC supported ?
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        // set name 
        this._setName(request);
        // for keepalive
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    _parseCookies (request) {
      var list = {},
          rc = request.headers.cookie;
  
      rc && rc.split(';').forEach(function( cookie ) {
          var parts = cookie.split('=');
          list[parts.shift().trim()] = decodeURI(parts.join('='));
      });
  
      return list;
  }

    _setIP(request) {
        if (request.headers['x-forwarded-for']) { 
            this.cookies = this._parseCookies(request);
            this.ip = this.cookies.roomId;
        } else {
            this.cookies = this._parseCookies(request);
            this.ip = this.cookies.roomId;
        }
    }

    _setPeerId(request) {
        if (request.peerId) {
            this.id = request.peerId;
        } else {
            console.log(this.cookies.peerid)
            this.id = this.cookies.peerid;
        }
    }

    toString() {
        return `<Peer id=${this.id} ip=${this.ip} rtcSupported=${this.rtcSupported}>`
    }

    _setName(req) {
        let ua = parser(req.headers['user-agent']);

        let deviceName = undefined;
        let wallet = 'Message Only';
        let displayName = undefined;
        
        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
        }
        
        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }

        if(deviceName == undefined) {
            deviceName = 'Unknown Device';
        }


        if(!displayName) {
            displayName = uniqueNamesGenerator({
                length: 2,
                separator: ' ',
                dictionaries: [colors, animals],
                style: 'capital',
                seed: this.id.hashCode()
                });
            } 

        this.name = {
            deviceName,
            displayName,
            wallet
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        }
    }

    // return uuid of form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    static uuid() {
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
}

Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    var hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr   = this.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }
});

new PortServer();


// -------------- xApp Integration Routes ------------------   //

const uuidv4 = new RegExp(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i);

axios.defaults.baseURL = 'https://xumm.app/api/v1/platform'
axios.defaults.headers.post['Content-Type'] = 'application/json'

app.use(['/xapp/ott/:token','/curated-assets','/payload','/payload/:payload_uuid','/event','/push','/xumm/init'], cors(corsOptions))
app.use(['/xapp/ott/:token','/curated-assets','/payload','/payload/:payload_uuid','/event','/push','/xumm/init'], express.json({limit:"1mb"}));
app.use(['/xapp/ott/:token','/curated-assets','/payload','/payload/:payload_uuid','/event','/push','/xumm/init'], helmet())


const reqApiKeyMatch = (req, res, next) => {
    const reqApiKey = req.header('x-api-key');
 
    console.log(` --- reqApiKey: ${reqApiKey}`)
    if (typeof reqApiKey === 'string' && uuidv4.test(reqApiKey.trim())) {
      const envKey = 'XAPP_' + reqApiKey.trim().replace(/-/g, '_')
      if (Object.keys(process.env).indexOf(envKey) > -1) {

        // Attach prepared axios headers on this specific req.
        Object.assign(req, {
          xummAuthHeaders: {
            headers: {
              'X-API-Key': reqApiKey.trim(),
              'X-API-Secret': process.env[envKey]
            }
          }
        })
        return next()
      }
    }
    console.log('Invalid or missing req API key header')
    res.status(403).json({
      msg: 'Preflight error, missing API key header or invalid',
      error: true
    })
  }
  

const authorize = (req, res, next) => {
    try {
        const decodedJwt = jwt.verify(req.header('Authorization'), process.env.XAPP_SECRET);
        const reqApiKey = decodedJwt.app;

        if (typeof reqApiKey === 'string' && uuidv4.test(reqApiKey.trim())) {
        const envKey = 'XAPP_' + reqApiKey.trim().replace(/-/g, '_')

            console.log(envKey);
            console.log(Object.keys(process.env).indexOf(envKey))

        if (Object.keys(process.env).indexOf(envKey) > -1) {
            // Attach prepared axios headers on this specific req.

            console.log(reqApiKey.trim());
            console.log(process.env[envKey]);

            Object.assign(req, {
            xummAuthHeaders: {
                headers: {
                'X-API-Key': reqApiKey.trim(),
                'X-API-Secret': process.env[envKey]
                }
            }
            })

            // `return` to skip the error response, no code after here
            return next();
        }
    }

    console.log('Invalid or missing req API key in JWT')
    res.status(403).json({
    msg: 'JWT missing valid API Key',
    error: e.message
    })    
} catch(e) {
    res.status(403).json({
    msg: 'invalid token',
    error: e.message
    })
}
}

app.get('/xumm/init', reqApiKeyMatch, async (req, res) => {
    
      const authToken = jwt.sign({
        app: req.xummAuthHeaders.headers['X-API-Key']
      }, process.env.XAPP_SECRET, { expiresIn: '4h' })

      let data = authToken;

      res.json(data)
  })

app.get('/xapp/ott/:token', reqApiKeyMatch, async (req, res) => {
    const token = req.params.token
    
    if (typeof token !== 'string') {
      console.log('No token given respond 400')
      return res.status(400).json({
        msg: 'Token undefined / invalid',
        error: true
      })
    }
  
    if (!uuidv4.test(token)) {
    console.log('No token given respond 401')
      return res.status(401).json({
        msg: 'Invalid token format',
        error: true
      })
    }
    
    try {

      const response = await axios.get(`/xapp/ott/${token}`, req.xummAuthHeaders)

      const authToken = jwt.sign({
        ott: token,
        app: req.xummAuthHeaders.headers['X-API-Key']
      }, process.env.XAPP_SECRET, { expiresIn: '4h' })

      response.data['token'] = authToken;
      res.json(response.data)

    } catch(e) {
        console.log(`XUMM API error @ ott fetch: ${e.message}`)
      res.status(400).json({
        msg: e.message,
        error: true
      })
    }
  })

  app.get('/curated-assets', authorize, async (req, res) => {
    try {
      const response = await axios.get('/curated-assets', req.xummAuthHeaders)
      res.json(response.data)
    } catch(e) {
      console.log(`XUMM API error @ curated assets: ${e.message}`)
      res.status(400).json({
        msg: e.message,
        error: true
      })
    }
  })
  
  app.post('/payload', authorize, async (req, res) => {

    console.log(req.body)
    console.log(req.xummAuthHeaders)

    try {
      const response = await axios.post('/payload', req.body, req.xummAuthHeaders)
      console.log(response.data)
      res.json(response.data)
    } catch(e) {
      console.log(`XUMM API error @ payload post: ${e.message}`)
      res.status(400).json({
        msg: e.message,
        error: true
      })
    }
  })
  
  
  app.get('/payload/:payload_uuid', authorize, async (req, res) => {
    const uuid = req.params.payload_uuid
    
    if (typeof uuid === undefined) {
      console.log('No token given respond 400')
      return res.status(400).json({
        msg: 'Token undefined',
        error: true
      })
    }
    
    try {
      const response = await axios.get(`/payload/${uuid}`, req.xummAuthHeaders)
      console.log(response.data)
      res.json(response.data)
    } catch(e) {
      console.log(`XUMM API error @ payload get: ${e.message}`)
      res.status(400).json({
        msg: e.message,
        error: true
      })
    }
  })

  app.post('/event', authorize, async (req, res) => {

    const token = req.params.token
    try {
      const response = await axios.post('/event', req.body, req.xummAuthHeaders)
      res.json(response.data)
    } catch(e) {
      console.log(`XUMM API error @ curated assets: ${e.message}`)
      res.status(400).json({
        msg: e.message,
        error: true
      })
    }
  })

  app.post('/push', authorize, async (req, res) => {

    const token = req.params.token

    try {
      const response = await axios.post('/push', req.body, req.xummAuthHeaders)
      res.json(response.data)
    } catch(e) {
      console.log(`XUMM API error @ curated assets: ${e.message}`)
      res.status(400).json({
        msg: e.message,
        error: true
      })
    }
  })


  
  app.get('*', async (req, res) => {
    res.status(404).json({
      msg: 'Not found, see XUMM API Docs @ https://xumm.readme.io',
      error: true
    })
  })


