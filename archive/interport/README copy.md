## testport-react

![alt text](https://github.com/whirledlabs/testport-react/blob/main/client/public/images/twitter_stream.jpg)

# Getting Started

## This is a react version of testport

*Send, pay, settle, peer-to-peer*


The main folder holds the backend environment - Server (server.js) and the XUMM SDK intergration (xumm.js)
The client folder holds the react app in the frontend environment.

To get up and running, install all dependancies in both the backend envrionment and the frontend environment.

```
npm install
```

Then go to the XUMM developer dashboard and create a sample app. Acquire the applicaiton key and secret key for your sample app and place them in an .env file in the back-end environment. Do not place the keys in the client folder as these should never be displayed publically.

https://apps.xumm.dev/

The format of the .env files is as follows:
```
PORT="3000"

XAPP_xxxxxxxx_xxxx_xxxx_xxxx_xxxxxxxxxxxx=xxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
XAPP_SECRET=JWTSECRET

APIKEY=xxxxxxxx_xxxx_xxxx_xxxx_xxxxxxxxxxxx"
APISECRET="xxxxxxxx_xxxx_xxxx_xxxx_xxxxxxxxxxxx"

API_ENDPOINT="https://testport.whirled.io"
XAPP_KEY="xxxxxxxx_xxxx_xxxx_xxxx_xxxxxxxxxxxx"

DEBUG=xapp* node index.js
```

The first grouping of keys is used for intergration with cors and xApp. 
(Note: The key is separated with underscore whereas the secret is separated with dashes)
The second grouping of keys is used for XUMM SDK backend.

Both sets of keys are identical, but different formatting.

# CORS, Routing, and SSL

You will need to change a few things in the development environment that have not beeb built into scripts yet.
1. In server JS, comment out the forceSSL() functions. This is not appropiate for localhost..
2. In the xApp.js file in the plugin folder, change the endpoint, comment out the whirled.io...
3. In the xumm.js file in the plugin folder, change the endpoint, comment out the whirled.io...



# TO DO 

- Connect the back-end environement (NodeJS) to the front-end environment (ReactJS)
- Inject WebView script in the front-end to be deployed when in xApp. This will give the ability to listen to an emmitted event whe nthe user hits the close button
- Add "add account" button when a user is in xApp and give the users the ability to change their wallet address once opened
- Add postMesssage commands for all of the URL window opens for when a users boots from an xApp
- Add build scripts and gulp to minify for deployment


# Disclosure
tesport is an adaption of snapdrop by Robin Linus. See link below for the source code and support his work.
https://github.com/RobinLinus/snapdrop

Notable changes include, but not limited to:
- Change framework to reactJS
- Added group fucntionality (message and payments) and contributed them to snapdrop
- Added plugins and UI to enable payments
- Change UI to allow users to change alias and input wallet addresses
- Integration with reactNativeWebView and XUMM
- Changed branding and all graphics
- Removed file sharing capabilites
- Changed themes and colors




