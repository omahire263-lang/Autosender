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

// Pairing code login - uses FRESH socket, ignores stored session
whatsappRouter.post('/auth/pair', async (req, res) => {
    let phone = req.body.phone?.replace(/[^0-9]/g, '');
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    try {
        if (sock) {
            try { await sock.logout(); } catch {}
            sock = null;
        }

        const db = getDb();
        const docRef = db.collection('whatsapp_sessions').doc(WA_SESSION_DOC);
        await docRef.delete().catch(() => {});

        await initWhatsApp();
        await delay(5000);

        if (!sock) {
            return res.status(500).json({ error: 'Failed to initialize WhatsApp. Please try again.' });
        }

        if (sock.user) {
            return res.status(400).json({ error: 'WhatsApp is already logged in. Please logout first.' });
        }

        const code = await sock.requestPairingCode(phone);
        res.json({ success: true, code: code?.match(/.{1,4}/g)?.join('-') || code });
    } catch (err: any) {
        console.error('Pairing error', err);
        res.status(500).json({ error: err.message || 'Failed to request pairing code' });
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

// ─── Groups: only admin groups ───────────────────────────────────────────────
// Cache for groups to avoid repeated expensive fetches
let groupsCache: { id: string; subject: string; isAdmin: boolean }[] | null = null;
let groupsCacheTime = 0;
const GROUPS_CACHE_TTL_MS = 60000;

whatsappRouter.get('/groups', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    try {
        const now = Date.now();
        if (groupsCache && (now - groupsCacheTime < GROUPS_CACHE_TTL_MS)) {
            return res.json({ groups: groupsCache });
        }

        const chats = await activeSock.groupFetchAllParticipating();
        if (!activeSock.user) {
            return res.status(400).json({ error: 'WhatsApp disconnected while fetching groups' });
        }
        const myJid = jidNormalizedUser(activeSock.user.id);

        const allGroups = Object.values(chats).map(g => {
            const isAdmin = (g.participants || []).some(
                p => jidNormalizedUser(p.id) === myJid &&
                (p.admin === 'admin' || p.admin === 'superadmin')
            );
            return {
                id: g.id,
                subject: g.subject,
                isAdmin,
                participantCount: (g.participants || []).length
            };
        });

        // Only return admin groups
        groupsCache = allGroups.filter(g => g.isAdmin);
        groupsCacheTime = now;

        res.json({ groups: groupsCache });
    } catch (e: any) {
        console.error('Error fetching WhatsApp groups:', e);
        if (getActiveSocket()) {
            res.status(500).json({ error: e.message || 'Failed to fetch groups' });
        } else {
            res.status(400).json({ error: 'WhatsApp disconnected while fetching groups' });
        }
    }
});

// ─── Add contacts to group in safe batches ──────────────────────────────────
whatsappRouter.post('/groups/add', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    const groupId = req.body.groupId;
    const contacts: string[] = req.body.contacts || [];
    if (!groupId || contacts.length === 0) {
        return res.status(400).json({ error: 'Group ID and contacts required' });
    }

    const jids = contacts
        .map(c => c.replace(/[^0-9]/g, ''))
        .filter(p => p.length >= 10)
        .map(p => `${p}@s.whatsapp.net`);

    if (jids.length === 0) {
        return res.status(400).json({ error: 'No valid phone numbers provided' });
    }

    res.json({
        success: true,
        message: `Adding ${jids.length} contacts in batches of ${MAX_ADD_PER_BATCH}...`,
        totalContacts: jids.length,
        batches: Math.ceil(jids.length / MAX_ADD_PER_BATCH)
    });

    // Process in background
    (async () => {
        try {
            const batches = chunkArray(jids, MAX_ADD_PER_BATCH);
            let addedCount = 0;
            let failedCount = 0;
            const failedList: string[] = [];

            for (let i = 0; i < batches.length; i++) {
                const currentSock = getActiveSocket();
                if (!currentSock) {
                    console.error('WhatsApp disconnected during group add process');
                    break;
                }

                try {
                    const result = await currentSock.groupParticipantsUpdate(groupId, batches[i], 'add');
                    const results = Array.isArray(result) ? result : [result];
                    for (const r of results) {
                        if (typeof r.status === 'string' && (r.status === '200' || r.status === 'success')) {
                            addedCount++;
                        } else {
                            failedCount++;
                            failedList.push(r.status || 'unknown');
                        }
                    }
                    console.log(`Batch ${i + 1}/${batches.length} completed. Total added: ${addedCount}`);
                } catch (e: any) {
                    // Individual batch failed - likely rate limit or group full
                    failedCount += batches[i].length;
                    failedList.push(e.message || 'Batch failed');
                    console.error(`Batch ${i + 1} failed: ${e.message}`);

                    // If rate limited, wait longer
                    if (e.message?.includes('429') || e.message?.includes('rate')) {
                        console.log('Rate limited, waiting 60 seconds...');
                        await delay(60000);
                    }
                }

                // Wait between batches (skip delay after last batch)
                if (i < batches.length - 1) {
                    const extraDelay = failedList.length > 0 ? 5000 : 0;
                    await delay(DELAY_BETWEEN_BATCHES_MS + extraDelay);
                }
            }
        } catch (e) {
            console.error('Group add process error:', e);
        }
    })();
});

// ─── Remove participants from group ─────────────────────────────────────────
whatsappRouter.post('/groups/remove', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    const groupId = req.body.groupId;
    const contacts: string[] = req.body.contacts || [];
    if (!groupId || contacts.length === 0) {
        return res.status(400).json({ error: 'Group ID and contacts required' });
    }

    const jids = contacts
        .map(c => c.replace(/[^0-9]/g, ''))
        .filter(p => p.length >= 10)
        .map(p => `${p}@s.whatsapp.net`);

    try {
        const result = await activeSock.groupParticipantsUpdate(groupId, jids, 'remove');
        res.json({ success: true, result });
    } catch (e: any) {
        console.error('Failed to remove members from WA group:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─── Send personal messages (anti-ban) ───────────────────────────────────────
whatsappRouter.post('/send/personal', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    const contacts: string[] = req.body.contacts || [];
    const message = req.body.message;
    if (!message || contacts.length === 0) {
        return res.status(400).json({ error: 'Message and contacts required' });
    }

    const totalContacts = contacts.length;
    res.json({
        success: true,
        message: `Starting personal campaign for ${totalContacts} contacts with anti-ban delays`,
        totalContacts,
        estimatedTime: `${Math.round((totalContacts * (MIN_MSG_DELAY_MS + MAX_MSG_DELAY_MS) / 2) / 1000 / 60)} min approx`
    });

    // Process in background
    (async () => {
        try {
            let sent = 0;
            let failed = 0;
            let skipped = 0;

            for (let i = 0; i < contacts.length; i++) {
                const currentSock = getActiveSocket();
                if (!currentSock) {
                    console.error('WhatsApp disconnected during personal send');
                    break;
                }

                const phone = contacts[i].replace(/[^0-9]/g, '');
                if (!phone || phone.length < 10) {
                    skipped++;
                    continue;
                }

                const jid = `${phone}@s.whatsapp.net`;

                try {
                    const spinnedMessage = antiBanSpin(message);
                    const result = await currentSock.sendMessage(jid, { text: spinnedMessage });
                    sent++;
                    console.log(`[${i + 1}/${contacts.length}] Sent personal msg to ${phone}`);
                } catch (e: any) {
                    failed++;
                    console.error(`[${i + 1}/${contacts.length}] Failed personal msg to ${phone}: ${e.message}`);

                    // Handle flood/rate limit
                    if (e.message?.includes('429') ||
                        e.message?.includes('rate') ||
                        e.message?.includes('flood') ||
                        e.message?.includes('too many')) {
                        console.log('Rate limited! Waiting 5 minutes before retrying...');
                        await delay(300000);
                        // Retry once
                        try {
                            const retryMsg = antiBanSpin(message);
                            await currentSock.sendMessage(jid, { text: retryMsg });
                            sent++;
                            failed--;
                            console.log(`[${i + 1}/${contacts.length}] Retry successful for ${phone}`);
                        } catch (retryError: any) {
                            console.error(`Retry also failed for ${phone}: ${retryError.message}`);
                        }
                    }
                }

                // Human-like delay before next message (skip after last)
                if (i < contacts.length - 1) {
                    const waitMs = Math.floor(Math.random() * (MAX_MSG_DELAY_MS - MIN_MSG_DELAY_MS + 1)) + MIN_MSG_DELAY_MS;
                    await delay(waitMs);
                }
            }

            // Save campaign result to Firestore
            try {
                const db = getDb();
                await db.collection('campaigns').add({
                    type: 'whatsapp_personal',
                    status: 'Completed',
                    totalUsers: totalContacts,
                    sentCount: sent,
                    failedCount: failed,
                    skippedCount: skipped,
                    message: message.substring(0, 100),
                    createdAt: new Date(),
                    completedAt: new Date()
                });
            } catch (e) {
                console.error('Failed to save campaign result:', e);
            }

            console.log(`\nPersonal campaign finished: ${sent} sent, ${failed} failed, ${skipped} skipped`);
        } catch (e) {
            console.error('Personal campaign error:', e);
        }
    })();
});

// ─── Campaign start (batch send with anti-ban) ───────────────────────────────
whatsappRouter.post('/campaign/start', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    const contacts: string[] = req.body.contacts || [];
    const message = req.body.message;
    const baseDelay = Number(req.body.delaySeconds) || 15;

    if (!message || contacts.length === 0) {
        return res.status(400).json({ error: 'Message and contacts required' });
    }

    const clampedDelay = Math.max(10, Math.min(60, baseDelay));

    res.json({
        success: true,
        message: `Campaign started for ${contacts.length} contacts`,
        totalContacts: contacts.length,
        delaySeconds: clampedDelay,
        estimatedTime: `${Math.round((contacts.length * clampedDelay) / 60)} min approx`
    });

    // Process in background
    (async () => {
        try {
            let sent = 0;
            let failed = 0;
            let skipped = 0;

            for (let i = 0; i < contacts.length; i++) {
                const currentSock = getActiveSocket();
                if (!currentSock) {
                    console.error('WhatsApp disconnected during campaign');
                    break;
                }

                const phone = contacts[i].replace(/[^0-9]/g, '');
                if (!phone || phone.length < 10) {
                    skipped++;
                    continue;
                }

                const jid = `${phone}@s.whatsapp.net`;

                try {
                    const spinnedMessage = antiBanSpin(message);
                    await currentSock.sendMessage(jid, { text: spinnedMessage });
                    sent++;
                } catch (e: any) {
                    failed++;
                    console.error(`Failed to send campaign msg to ${phone}: ${e.message}`);

                    if (e.message?.includes('429') ||
                        e.message?.includes('rate') ||
                        e.message?.includes('flood')) {
                        console.log('Rate limited during campaign! Waiting 5 minutes...');
                        await delay(300000);
                    }
                }

                const jitter = Math.floor(Math.random() * 10000) - 5000;
                const totalDelay = Math.max(5000, clampedDelay * 1000 + jitter);
                await delay(totalDelay);
            }
        } catch (e) {
            console.error('Campaign error:', e);
        }
    })();
});
