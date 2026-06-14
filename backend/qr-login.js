const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;

if (!apiId || !apiHash) {
  console.error("API_ID or API_HASH is missing in .env");
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 5,
});

async function start() {
  console.log("Connecting to Telegram...");
  await client.connect();

  console.log("\nGenerating QR Code...");
  
  await client.signInUserWithQrCode(
    { apiId, apiHash },
    {
      onError: (err) => console.error("Error:", err),
      qrCode: (code) => {
        // code.token is a buffer containing the auth token
        // The format for Telegram QR login is: tg://login?token=base64url(token)
        const token = code.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const url = `tg://login?token=${token}`;
        
        console.log("\n==========================================");
        console.log("SCAN THIS QR CODE WITH YOUR TELEGRAM APP");
        console.log("Go to: Settings -> Devices -> Link Desktop Device");
        console.log("==========================================\n");
        
        qrcode.generate(url, { small: true });
      },
    }
  );

  console.log("\nLogin successful!");
  const sessionString = client.session.save();
  console.log("\n========================================================");
  console.log("YOUR SESSION STRING IS (Copy everything below):");
  console.log("========================================================");
  console.log(sessionString);
  console.log("========================================================");
  console.log("\nNow you can paste this Session String in the website's 'Session String' login tab!");
  
  process.exit(0);
}

start().catch(console.error);
