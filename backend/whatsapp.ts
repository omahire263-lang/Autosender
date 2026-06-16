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

// ─── Firestore Auth State (persistent like Telegram session) ─────────────────
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

// ─── Check if session exists in Firestore ────────────────────────────────────
async function hasStoredSession(): Promise<boolean> {
    try {
        const db = getDb();
        const doc = await db.collection('whatsapp_sessions').doc(WA_SESSION_DOC).get();
        return doc.exists && !!doc.data()?.creds;
    } catch {
        return false;
    }
}

// ─── Init WhatsApp (uses Firestore for persistence) ─────────────────────────
export async function initWhatsApp() {
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
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('WhatsApp disconnected, reconnecting...');
                initWhatsApp();
            } else {
                // Logged out — clear Firestore session
                sock = null;
                getDb().collection('whatsapp_sessions').doc(WA_SESSION_DOC).delete()
                    .then(() => console.log('WhatsApp session cleared from Firestore'))
                    .catch(console.error);
            }
        } else if (connection === 'open') {
            console.log('WhatsApp connected successfully via Firestore session!');
        }
    });
}

// ─── Auto-connect on boot if session exists ──────────────────────────────────
(async () => {
    if (await hasStoredSession()) {
        console.log('Found stored WhatsApp session in Firestore, auto-connecting...');
        initWhatsApp();
    }
})();

// ─── Routes ──────────────────────────────────────────────────────────────────

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

whatsappRouter.post('/auth/login-session', async (req, res) => {
    let { sessionString } = req.body;
    if (!sessionString) return res.status(400).json({ error: 'Session string is required' });

    try {
        // Remove any whitespace, newlines, or invisible characters
        sessionString = sessionString.replace(/\s+/g, '').trim();
        const jsonStr = Buffer.from(sessionString, 'base64').toString('utf-8');
        const data = JSON.parse(jsonStr);
        
        if (!data.creds) {
            return res.status(400).json({ error: 'Invalid session string format (missing creds)' });
        }

        const db = getDb();
        await db.collection('whatsapp_sessions').doc(WA_SESSION_DOC).set(data);

        // Re-initialize whatsapp with new session
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

whatsappRouter.post('/auth/pair', async (req, res) => {
    let phone = req.body.phone?.replace(/[^0-9]/g, '');
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    if (!sock) {
        await initWhatsApp();
    }

    await delay(2000);

    try {
        const code = await sock!.requestPairingCode(phone);
        res.json({ success: true, code: code?.match(/.{1,4}/g)?.join('-') || code });
    } catch (err: any) {
        console.error('Pairing error', err);
        res.status(500).json({ error: err.message || 'Failed to request pairing code' });
    }
});

whatsappRouter.get('/status', (req, res) => {
    res.json({ isConnected: !!sock?.user });
});

whatsappRouter.post('/auth/logout', async (req, res) => {
    if (sock) {
        try { await sock.logout(); } catch {}
        sock = null;
    }
    try {
        await getDb().collection('whatsapp_sessions').doc(WA_SESSION_DOC).delete();
    } catch {}
    res.json({ success: true });
});

// Campaign sending
whatsappRouter.post('/campaign/start', async (req, res) => {
    if (!sock?.user) return res.status(400).json({ error: 'WhatsApp not connected' });

    const contacts: string[] = req.body.contacts || [];
    const message = req.body.message;
    if (!message || contacts.length === 0) return res.status(400).json({ error: 'Message and contacts required' });

    res.json({ success: true, message: 'Campaign started in background' });

    for (const rawPhone of contacts) {
        const phone = rawPhone.replace(/[^0-9]/g, '');
        if (!phone) continue;
        const jid = `${phone}@s.whatsapp.net`;
        try {
            const spinnedMessage = antiBanSpin(message);
            await sock.sendMessage(jid, { text: spinnedMessage });
            console.log(`WhatsApp sent to ${phone}`);
        } catch (e) {
            console.error(`WhatsApp failed to send to ${phone}`, e);
        }
        await delay(Math.random() * 6000 + 4000);
    }
});

whatsappRouter.get('/groups', async (req, res) => {
    if (!sock?.user) return res.status(400).json({ error: 'WhatsApp not connected' });

    try {
        const chats = await sock.groupFetchAllParticipating();
        const myJid = jidNormalizedUser(sock.user?.id);

        const groups = Object.values(chats).map(g => {
            const isAdmin = g.participants.some(p => jidNormalizedUser(p.id) === myJid && (p.admin === 'admin' || p.admin === 'superadmin'));
            return { id: g.id, subject: g.subject, isAdmin };
        });

        res.json({ groups });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

whatsappRouter.post('/groups/add', async (req, res) => {
    if (!sock?.user) return res.status(400).json({ error: 'WhatsApp not connected' });

    const groupId = req.body.groupId;
    const contacts: string[] = req.body.contacts || [];
    if (!groupId || contacts.length === 0) return res.status(400).json({ error: 'Group ID and contacts required' });

    const jids = contacts.map(c => c.replace(/[^0-9]/g, '') + '@s.whatsapp.net');

    try {
        const response = await sock.groupParticipantsUpdate(groupId, jids, 'add');
        res.json({ success: true, response });
    } catch (e: any) {
        console.error('Failed to add members to WA group', e);
        res.status(500).json({ error: e.message });
    }
});
