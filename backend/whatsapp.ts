import {
    makeWASocket,
    DisconnectReason,
    delay,
    initAuthCreds,
    BufferJSON,
    proto,
    AuthenticationState,
    SignalDataTypeMap,
    jidNormalizedUser
} from '@whiskeysockets/baileys';
import pino from 'pino';
import express from 'express';
import { Boom } from '@hapi/boom';
import { getDb } from './models';
import { antiBanSpin } from './server';

export const whatsappRouter = express.Router();

let sock: ReturnType<typeof makeWASocket> | null = null;
const logger = pino({ level: 'silent' });

const WA_SESSION_DOC = 'main';
const MAX_ADD_PER_BATCH = 10;
const DELAY_BETWEEN_BATCHES_MS = 8000;
const MIN_MSG_DELAY_MS = 10000;
const MAX_MSG_DELAY_MS = 30000;

// ─── Firestore Auth State ────────────────────────────────────────────────────
async function useFirestoreAuthState(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    const db = getDb();
    const docRef = db.collection('whatsapp_sessions').doc(WA_SESSION_DOC);
    const doc = await docRef.get();
    const stored = doc.exists ? doc.data()! : {};

    const creds = stored.creds
        ? JSON.parse(stored.creds, BufferJSON.reviver)
        : initAuthCreds();

    const keys: Record<string, any> = stored.keys
        ? JSON.parse(stored.keys, BufferJSON.reviver)
        : {};

    const state: AuthenticationState = {
        creds,
        keys: {
            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                const result: { [id: string]: SignalDataTypeMap[T] } = {};
                for (const id of ids) {
                    const keyId = `${type}-${id}`;
                    let value = keys[keyId];
                    if (type === 'app-state-sync-key' && value) {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    if (value !== undefined) result[id] = value;
                }
                return result;
            },
            set: async (data) => {
                const anyData = data as any;
                for (const category in anyData) {
                    for (const id in anyData[category]) {
                        const keyId = `${category}-${id}`;
                        const value = anyData[category][id];
                        if (value) {
                            keys[keyId] = value;
                        } else {
                            delete keys[keyId];
                        }
                    }
                }
                await docRef.set(
                    { keys: JSON.stringify(keys, BufferJSON.replacer) },
                    { merge: true }
                );
            }
        }
    };

    const saveCreds = async () => {
        await docRef.set(
            { creds: JSON.stringify(creds, BufferJSON.replacer) },
            { merge: true }
        );
    };

    return { state, saveCreds };
}

async function hasStoredSession(): Promise<boolean> {
    try {
        const db = getDb();
        const doc = await db.collection('whatsapp_sessions').doc(WA_SESSION_DOC).get();
        return doc.exists && !!doc.data()?.creds;
    } catch {
        return false;
    }
}

function getActiveSocket() {
    return sock?.user ? sock : null;
}

// ─── Utility: chunk array into batches ──────────────────────────────────────
function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// ─── Anti-ban: human-like random delay ──────────────────────────────────────
function humanDelay(min: number = MIN_MSG_DELAY_MS, max: number = MAX_MSG_DELAY_MS): Promise<void> {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return delay(ms);
}

// ─── Init WhatsApp ───────────────────────────────────────────────────────────
let isInitializing = false;

export async function initWhatsApp() {
    if (isInitializing) return;
    if (sock?.user) return;
    isInitializing = true;

    try {
        const { state, saveCreds } = await useFirestoreAuthState();

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger,
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut) {
                    sock = null;
                    isInitializing = false;
                    getDb().collection('whatsapp_sessions').doc(WA_SESSION_DOC).delete()
                        .then(() => console.log('WhatsApp session cleared from Firestore'))
                        .catch(console.error);
                } else {
                    console.log('WhatsApp temporarily disconnected, Baileys will auto-reconnect...');
                    isInitializing = false;
                }
            } else if (connection === 'open') {
                console.log('WhatsApp connected successfully!');
                isInitializing = false;
            }
        });
    } catch (error) {
        console.error('Failed to initialize WhatsApp socket:', error);
        sock = null;
        isInitializing = false;
        setTimeout(() => {
            if (!sock && !isInitializing) initWhatsApp();
        }, 5000);
    }
}

// ─── Auto-connect on boot ────────────────────────────────────────────────────
(async () => {
    try {
        if (await hasStoredSession()) {
            console.log('Found stored WhatsApp session in Firestore, auto-connecting...');
            initWhatsApp();
        }
    } catch (error) {
        console.error('Auto-connect check failed:', error);
    }
})();

// ─── Routes ──────────────────────────────────────────────────────────────────

// Get session string for backup
whatsappRouter.get('/auth/session-string', async (req, res) => {
    try {
        const db = getDb();
        const doc = await db.collection('whatsapp_sessions').doc(WA_SESSION_DOC).get();
        if (!doc.exists) return res.status(404).json({ error: 'No active session found' });
        const data = doc.data();
        const jsonStr = JSON.stringify(data);
        const base64Str = Buffer.from(jsonStr).toString('base64');
        res.json({ sessionString: base64Str });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Login with session string
whatsappRouter.post('/auth/login-session', async (req, res) => {
    let { sessionString } = req.body;
    if (!sessionString) return res.status(400).json({ error: 'Session string is required' });

    try {
        sessionString = sessionString.replace(/\s+/g, '').trim();
        const jsonStr = Buffer.from(sessionString, 'base64').toString('utf-8');
        const data = JSON.parse(jsonStr);
        if (!data.creds) {
            return res.status(400).json({ error: 'Invalid session string format (missing creds)' });
        }

        const db = getDb();
        await db.collection('whatsapp_sessions').doc(WA_SESSION_DOC).set(data);

        if (sock) {
            try { sock.logout(); } catch {}
            sock = null;
        }
        await initWhatsApp();
        res.json({ success: true, message: 'Logged in using session string' });
    } catch (e: any) {
        console.error('Login via session string failed:', e);
        res.status(500).json({ error: 'Failed to process session string. It may be invalid.' });
    }
});

// Pairing code login - robust with retry and connection wait
whatsappRouter.post('/auth/pair', async (req, res) => {
    let phone = req.body.phone?.replace(/[^0-9]/g, '');
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    const sendError = (msg: string) => res.status(500).json({ error: msg });

    try {
        const existingSock = sock;
        if (existingSock) {
            try { await existingSock.logout(); } catch {}
        }
        sock = null;

        const db = getDb();
        await db.collection('whatsapp_sessions').doc(WA_SESSION_DOC).delete().catch(() => {});

        await initWhatsApp();

        let attempts = 0;
        let code: string | undefined;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            try {
                await delay(6000);

                const currentSock = sock as ReturnType<typeof makeWASocket> | null;
                if (!currentSock) {
                    if (attempts < maxAttempts) {
                        console.log(`Pairing attempt ${attempts}: socket not ready, retrying...`);
                        await initWhatsApp();
                        continue;
                    }
                    return sendError('Failed to initialize WhatsApp after multiple attempts.');
                }

                if (currentSock.user) {
                    return res.status(400).json({ error: 'WhatsApp is already logged in. Please logout first.' });
                }

                code = await currentSock.requestPairingCode(phone);
                break;
            } catch (err: any) {
                if (attempts >= maxAttempts) {
                    throw err;
                }
                const errMsg = err.message || 'Unknown error';
                if (errMsg.includes('Connection') || errMsg.includes('close') || errMsg.includes('network')) {
                    console.log(`Pairing attempt ${attempts} failed (${errMsg}), retrying in 5s...`);
                    await delay(5000);
                    if (!sock) await initWhatsApp();
                } else {
                    throw err;
                }
            }
        }

        res.json({ success: true, code: code?.match(/.{1,4}/g)?.join('-') || code });
    } catch (err: any) {
        console.error('Pairing error (final):', err);
        sendError(err.message || 'Failed to request pairing code');
    }
});

// Connection status
whatsappRouter.get('/status', (req, res) => {
    res.json({ isConnected: !!sock?.user });
});

// Logout
whatsappRouter.post('/auth/logout', async (req, res) => {
    if (sock) {
        try { await sock.logout(); } catch {}
        sock = null;
        isInitializing = false;
    }
    try {
        await getDb().collection('whatsapp_sessions').doc(WA_SESSION_DOC).delete();
    } catch {}
    res.json({ success: true });
});

// ─── Extract Members via Invite Link ─────────────────────────────────────────
whatsappRouter.post('/extract-group', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    let { link } = req.body;
    if (!link || typeof link !== 'string') {
        return res.status(400).json({ error: 'Group link is required' });
    }

    try {
        // Extract invite code
        let code = link;
        if (link.includes('chat.whatsapp.com/')) {
            code = link.split('chat.whatsapp.com/')[1].split('/')[0].split('?')[0];
        }

        if (!code) {
            return res.status(400).json({ error: 'Invalid WhatsApp group link format' });
        }

        // Join the group using the invite code
        console.log(`Joining group with code: ${code}`);
        const groupId = await activeSock.groupAcceptInvite(code);
        
        if (!groupId) {
             return res.status(400).json({ error: 'Failed to join group. The link might be invalid or expired.' });
        }

        // Fetch metadata to get participants
        console.log(`Successfully joined group ${groupId}. Fetching metadata...`);
        const metadata = await activeSock.groupMetadata(groupId);
        
        const participants = metadata.participants || [];
        const phoneNumbers = participants
            .map(p => p.id.split('@')[0])
            .filter(phone => phone && phone.length > 5); // Basic validation

        res.json({
            success: true,
            groupId,
            subject: metadata.subject,
            participantCount: phoneNumbers.length,
            members: phoneNumbers
        });
    } catch (e: any) {
        console.error('Error extracting group members:', e);
        
        let errorMsg = e.message || 'Failed to extract group members';
        if (errorMsg.includes('not-authorized')) {
            errorMsg = 'Not authorized to join this group or link revoked.';
        } else if (errorMsg.includes('item-not-found')) {
            errorMsg = 'Group not found or invite link expired.';
        }
        
        res.status(500).json({ error: errorMsg });
    }
});
