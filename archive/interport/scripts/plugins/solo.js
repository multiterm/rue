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