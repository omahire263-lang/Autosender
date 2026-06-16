import {
    makeWASocket,
    DisconnectReason,
    delay,
    initAuthCreds,
    BufferJSON,
    proto,
    AuthenticationState,
    SignalDataTypeMap,
    jidNormalizedUser,
    Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import express from 'express';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
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

let currentQr: string | null = null;
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
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250,
            generateHighQualityLinkPreview: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                currentQr = qr;
                isInitializing = false; // allow re-init if needed
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                isInitializing = false;
                if (statusCode === DisconnectReason.loggedOut) {
                    sock = null;
                    currentQr = null;
                    getDb().collection('whatsapp_sessions').doc(WA_SESSION_DOC).delete()
                        .then(() => console.log('WhatsApp session cleared from Firestore'))
                        .catch(console.error);
                } else {
                    console.log('WhatsApp temporarily disconnected, will retry...');
                    sock = null;
                    setTimeout(() => { if (!sock && !isInitializing) initWhatsApp(); }, 3000);
                }
            } else if (connection === 'open') {
                console.log('WhatsApp connected successfully!');
                currentQr = null;
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

// Get latest QR code for login
whatsappRouter.get('/auth/qr', async (req, res) => {
    if (!sock) {
        await initWhatsApp();
    }
    if (sock?.user) {
        return res.json({ error: 'Already connected', isConnected: true });
    }
    if (currentQr) {
        return res.json({ qr: currentQr });
    }
    res.json({ error: 'QR code not ready yet', isConnected: false });
});

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

// ─── Extract Members via Invite Link (Safe Mode for Personal Numbers) ──────────
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

        // Anti-ban: Human-like delay before joining (2 to 5 seconds)
        const joinDelay = Math.floor(Math.random() * 3000) + 2000;
        console.log(`[Anti-Ban] Waiting ${joinDelay}ms before joining...`);
        await delay(joinDelay);

        // Join the group using the invite code
        console.log(`Joining group with code: ${code}`);
        const groupId = await activeSock.groupAcceptInvite(code);
        
        if (!groupId) {
             return res.status(400).json({ error: 'Failed to join group. The link might be invalid or expired.' });
        }

        // Anti-ban: Human-like delay before fetching metadata (3 to 6 seconds)
        const metaDelay = Math.floor(Math.random() * 3000) + 3000;
        console.log(`[Anti-Ban] Waiting ${metaDelay}ms before fetching metadata...`);
        await delay(metaDelay);

        // Fetch metadata to get participants
        console.log(`Successfully joined group ${groupId}. Fetching metadata...`);
        const metadata = await activeSock.groupMetadata(groupId);
        
        const participants = metadata.participants || [];
        
        // Separate phone numbers and LID-based contacts
        const phoneNumbers: string[] = [];
        const lidContacts: string[] = [];
        
        for (const p of participants) {
            if (!p.id) continue;
            
            if (p.id.includes('@lid')) {
                // LID-based contact - WhatsApp privacy protected, but still usable for messaging
                lidContacts.push(p.id);
                continue;
            }
            
            if (p.id.includes('@g.us')) continue;
            
            const rawNumber = p.id.split('@')[0].split(':')[0];
            if (!rawNumber || rawNumber.length < 5) continue;
            
            try {
                const parsed = parsePhoneNumberFromString('+' + rawNumber);
                if (parsed) {
                    phoneNumbers.push(`+${parsed.countryCallingCode} ${parsed.nationalNumber}`);
                } else {
                    phoneNumbers.push('+' + rawNumber);
                }
            } catch {
                phoneNumbers.push('+' + rawNumber);
            }
        }

        // Note: LID contacts hide phone numbers per WhatsApp privacy
        // We can still message them directly using their LID ID

        // Send the response back to the user immediately
        const allContacts = [...phoneNumbers, ...lidContacts];
        res.json({
            success: true,
            groupId,
            subject: metadata.subject,
            participantCount: allContacts.length,
            phoneCount: phoneNumbers.length,
            lidCount: lidContacts.length,
            members: allContacts,
            message: `Extracted ${phoneNumbers.length} phone numbers. ${lidContacts.length} contacts are LID-protected (WhatsApp privacy). All ${allContacts.length} can receive messages.`
        });

        // Anti-ban: Automatically leave the group so it doesn't clutter the user's personal WhatsApp
        // We wait 5 to 10 seconds after extraction before leaving to make it look less like a bot.
        setTimeout(async () => {
            try {
                const leaveDelay = Math.floor(Math.random() * 5000) + 5000;
                console.log(`[Anti-Ban] Waiting ${leaveDelay}ms to silently leave group ${groupId}...`);
                await delay(leaveDelay);
                
                const currentSock = getActiveSocket();
                if (currentSock) {
                    await currentSock.groupLeave(groupId);
                    console.log(`[Anti-Ban] Successfully left group ${groupId} to prevent clutter.`);
                }
            } catch (leaveErr) {
                console.error(`Failed to auto-leave group ${groupId}:`, leaveErr);
            }
        }, 1000); // Trigger the timeout asynchronously

    } catch (e: any) {
        console.error('Error extracting group members:', e);
        
        let errorMsg = e.message || 'Failed to extract group members';
        if (errorMsg.includes('not-authorized')) {
            errorMsg = 'Not authorized to join this group or link revoked.';
        } else if (errorMsg.includes('item-not-found')) {
            errorMsg = 'Group not found or invite link expired.';
        } else if (errorMsg.includes('429') || errorMsg.includes('rate-overlimit')) {
            errorMsg = 'Rate limit reached! WhatsApp temporarily blocked joining. Try again after 1-2 hours.';
        }
        
        res.status(500).json({ error: errorMsg });
    }
});

// ─── Fetch All Joined Groups ────────────────────────────────────────────────
whatsappRouter.get('/groups', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    try {
        const groups = await activeSock.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(g => ({
            id: g.id,
            subject: g.subject,
            participantCount: g.participants?.length || 0
        }));
        res.json({ success: true, groups: groupList });
    } catch (error: any) {
        console.error('Failed to fetch WhatsApp groups:', error);
        res.status(500).json({ error: 'Failed to fetch WhatsApp groups' });
    }
});

// ─── Extract Members from Existing Group ────────────────────────────────────
whatsappRouter.post('/extract-existing-group', async (req, res) => {
    const activeSock = getActiveSocket();
    if (!activeSock) return res.status(400).json({ error: 'WhatsApp not connected' });

    let { groupId } = req.body;
    if (!groupId || typeof groupId !== 'string') {
        return res.status(400).json({ error: 'Group ID is required' });
    }

    try {
        console.log(`Fetching participants for existing group: ${groupId}`);

        // Always use groupMetadata — groupFetchAllParticipating returns @lid IDs
        // (WhatsApp multi-device internal IDs, not phone numbers)
        const metadata = await activeSock.groupMetadata(groupId);
        const participants = metadata.participants || [];
        const subject = metadata.subject || 'Unknown Group';

        console.log(`Got ${participants.length} raw participants for "${subject}"`);
        // Debug: log first few IDs to check format
        participants.slice(0, 5).forEach(p => console.log('  participant id:', p.id));
        
        // Separate phone numbers and LID-based contacts
        const phoneNumbers: string[] = [];
        const lidContacts: string[] = [];
        
        for (const p of participants) {
            if (!p.id) continue;
            
            if (p.id.includes('@lid')) {
                // LID-based contact - WhatsApp privacy protected, but still usable for messaging
                lidContacts.push(p.id);
                continue;
            }
            
            if (p.id.includes('@g.us')) continue;
            
            const rawNumber = p.id.split('@')[0].split(':')[0];
            if (!rawNumber || rawNumber.length < 5) continue;
            
            try {
                const parsed = parsePhoneNumberFromString('+' + rawNumber);
                if (parsed) {
                    phoneNumbers.push(`+${parsed.countryCallingCode} ${parsed.nationalNumber}`);
                } else {
                    phoneNumbers.push('+' + rawNumber);
                }
            } catch {
                phoneNumbers.push('+' + rawNumber);
            }
        }

        // Note: LID contacts hide phone numbers per WhatsApp privacy
        // We can still message them directly using their LID ID

        const allContacts = [...phoneNumbers, ...lidContacts];

        res.json({
            success: true,
            groupId,
            subject: subject,
            participantCount: allContacts.length,
            phoneCount: phoneNumbers.length,
            lidCount: lidContacts.length,
            members: allContacts,
            message: phoneNumbers.length > 0 
                ? `Extracted ${phoneNumbers.length} phone numbers and ${lidContacts.length} LID-protected contacts. All can receive messages.` 
                : lidContacts.length > 0 
                    ? `Extracted ${lidContacts.length} LID-protected contacts. WhatsApp privacy settings hide numbers, but these contacts can still receive messages.`
                    : "Extracted 0 members. Numbers might be hidden by WhatsApp privacy settings."
        });
    } catch (e: any) {
        console.error('Error extracting existing group members:', e);
        res.status(500).json({ error: e.message || 'Failed to extract group members' });
    }
});
