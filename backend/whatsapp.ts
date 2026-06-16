import { makeWASocket, useMultiFileAuthState, DisconnectReason, delay } from '@whiskeysockets/baileys';
import pino from 'pino';
import express from 'express';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import { antiBanSpin } from './server';

export const whatsappRouter = express.Router();

let sock: ReturnType<typeof makeWASocket> | null = null;
const logger = pino({ level: 'silent' });

export async function initWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_auth');

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
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                initWhatsApp();
            } else {
                sock = null;
                fs.rmSync('whatsapp_auth', { recursive: true, force: true });
            }
        }
    });
}

// Ensure init on boot if auth exists
if (fs.existsSync('whatsapp_auth')) {
    initWhatsApp();
}

whatsappRouter.post('/auth/pair', async (req, res) => {
    let phone = req.body.phone?.replace(/[^0-9]/g, '');
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    if (!sock) {
        await initWhatsApp();
    }
    
    // Wait for sock to be ready
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

whatsappRouter.post('/auth/logout', (req, res) => {
    if (sock) {
        sock.logout();
        sock = null;
    }
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
        await delay(Math.random() * 6000 + 4000); // 4-10 sec random delay to avoid ban
    }
});

whatsappRouter.get('/groups', async (req, res) => {
    if (!sock?.user) return res.status(400).json({ error: 'WhatsApp not connected' });
    
    try {
        const chats = await sock.groupFetchAllParticipating();
        const myJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
        
        const groups = Object.values(chats).map(g => {
            const isAdmin = g.participants.some(p => p.id === myJid && (p.admin === 'admin' || p.admin === 'superadmin'));
            return { id: g.id, subject: g.subject, isAdmin };
        }).filter(g => g.isAdmin);
        
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
        const response = await sock.groupParticipantsUpdate(groupId, jids, "add");
        res.json({ success: true, response });
    } catch (e: any) {
        console.error('Failed to add members to WA group', e);
        res.status(500).json({ error: e.message });
    }
});
