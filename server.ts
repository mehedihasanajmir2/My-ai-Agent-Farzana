import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import cookieSession from 'cookie-session';
import dotenv from 'dotenv';
import cron from 'node-cron';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

dotenv.config();

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

// Initialize Firebase Admin
try {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
} catch (e) {
  console.log('Firebase Admin already initialized');
}

// Get Firestore instance
const getAutopilotDb = () => {
  return firebaseConfig.firestoreDatabaseId 
    ? getFirestore(firebaseConfig.firestoreDatabaseId)
    : getFirestore();
};

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'fallback-secret'],
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  secure: true,
  sameSite: 'none',
}));

// Gemini Setup
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY || '');
const genModel = ai.getGenerativeModel({ 
  model: 'gemini-1.5-flash',
  tools: [{ googleSearch: {} } as any]
});

// Helper for absolute App URL
const getAppUrl = () => process.env.APP_URL || 'http://localhost:3000';

// --- Facebook OAuth ---

app.get('/api/auth/facebook/url', (req, res) => {
  const redirectUri = `${getAppUrl()}/api/auth/facebook/callback`;
  const appId = process.env.FACEBOOK_APP_ID;
  
  if (!appId) {
    return res.status(500).json({ error: 'FACEBOOK_APP_ID is not configured' });
  }

  const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=pages_show_list,pages_read_engagement,pages_manage_posts,publish_video`;
  res.json({ url });
});

app.get('/api/auth/facebook/callback', async (req, res) => {
  const { code } = req.query;
  const redirectUri = `${getAppUrl()}/api/auth/facebook/callback`;
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!code || typeof code !== 'string') {
    return res.status(400).send('No code provided');
  }

  try {
    const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: appId,
        redirect_uri: redirectUri,
        client_secret: appSecret,
        code,
      },
    });

    const accessToken = tokenResponse.data.access_token;
    
    // Get user info to act as UID
    const meResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: { access_token: accessToken },
    });

    if (req.session) {
      req.session.fbAccessToken = accessToken;
      req.session.fbUserId = meResponse.data.id;
    }

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. You can close this window.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('FB OAuth Error:', error.response?.data || error.message);
    res.status(500).send('Failed to authenticate with Facebook');
  }
});

app.get('/api/auth/facebook/status', (req, res) => {
  res.json({ 
    isAuthenticated: !!(req.session && req.session.fbAccessToken),
    userId: req.session?.fbUserId 
  });
});

app.post('/api/auth/facebook/logout', (req, res) => {
  if (req.session) {
    req.session.fbAccessToken = null;
    req.session.fbUserId = null;
  }
  res.json({ success: true });
});

// --- Autopilot Config Routes ---

app.post('/api/autopost/save', async (req, res) => {
  const { pageId, pageAccessToken, pageName, topic, language, isActive } = req.body;
  const userId = req.session?.fbUserId;

  if (!userId) return res.status(401).json({ error: 'User not identified' });
  if (!pageId || !pageAccessToken) return res.status(400).json({ error: 'Missing page details' });

  try {
    const docId = `${userId}_${pageId}`;
    const autopilotDb = getAutopilotDb();
    await autopilotDb.collection('autopostConfigs').doc(docId).set({
      userId,
      pageId,
      pageAccessToken,
      pageName,
      topic,
      language,
      isActive,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Save Autopost Error:', error.message);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

app.get('/api/autopost/config', async (req, res) => {
  const userId = req.session?.fbUserId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const autopilotDb = getAutopilotDb();
    const snapshot = await autopilotDb.collection('autopostConfigs')
      .where('userId', '==', userId)
      .get();
    
    const configs = snapshot.docs.map((doc: any) => doc.data());
    res.json(configs);
  } catch (error: any) {
    console.error('Get Autopost Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch configurations' });
  }
});

// --- Facebook Graph API Helpers ---

app.get('/api/facebook/pages', async (req, res) => {
  const accessToken = req.session?.fbAccessToken;
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const response = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: accessToken },
    });
    res.json(response.data.data); // Array of pages
  } catch (error: any) {
    console.error('FB Pages Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// --- Content Generation Helper ---

const USER_TOPICS = [
  "সত্যিকারের ভালোবাসার গল্প (Real Love Stories)",
  "লং ডিসটেন্স রিলেশনশিপ (LDR)",
  "হারানো প্রেমের গল্প",
  "পার্সোনাল ব্লগ ও নিজের অনুভূতি (Personal Insights)",
  "আজকের উপলব্ধি (Today's Thought)",
  "এক কাপ চা ও গল্প",
  "মুড পোস্ট",
  "ফ্যান ও দর্শক ইন্টারেকশন (Fan-Centric & Interactive)",
  "লস্ট ইন কমেন্টস (Lost in Comments)",
  "মেনশন গেম",
  "মিষ্টি ও মজার রিলেশনশিপ ট্রোল/মিম (Cute & Relatable Humour)",
  "সিঙ্গেল বনাম মিঙ্গেল",
  "অভিমান ও ভালোবাসা"
];

async function generateAIContent(topic: string, language: string) {
  // If the user provided a generic topic, we enrich it with their specific categories
  const topicContext = topic.toLowerCase().includes('love') || topic.toLowerCase().includes('গল্প') 
    ? `Focus on one of these categories: ${USER_TOPICS.join(', ')}.`
    : `Topic is: ${topic}`;

  const prompt = `Find and summarize a trending, highly engaging, and viral-worthy story, insight, or emotional post about "${topic}".
  ${topicContext}
  
  Guidelines:
  - If the topic is a "Story", make it heart-touching and emotional.
  - If it's an "Interaction/Game", make it interactive for fans (e.g. "Tag someone who...").
  - If it's a "Humour/Meme", make it relatable and funny.
  
  Provide the response in the following JSON format:
  {
    "title": "A catchy headline",
    "content": "The main post content, formatted for high engagement (use emojis, bullet points, and proper spacing).",
    "hashtags": ["#tag1", "#tag2", "#banglaquotes"],
    "imagePrompt": "A single word or short phrase representing the visual theme for an image lookup"
  }
  Language: ${language || 'Bengali'}
  Tone: Emotional, Engaging, and Relatable.`;

  const result = await genModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
    }
  });

  return JSON.parse(result.response.text() || '{}');
}

app.post('/api/generate-content', async (req, res) => {
  const { topic, language } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });

  try {
    const data = await generateAIContent(topic, language);
    res.json(data);
  } catch (error: any) {
    console.error('Gemini Error:', error.message);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

// --- Facebook Posting Helper ---

async function postToFacebook(pageId: string, pageAccessToken: string, message: string, topic: string) {
  try {
    // Generate a relevant image URL using LoremFlicker based on topic
    // This provides a "photo" as requested by the user
    const imageUrl = `https://loremflickr.com/800/600/${encodeURIComponent(topic.split(' ')[0])}`;
    
    return axios.post(`https://graph.facebook.com/v18.0/${pageId}/photos`, null, {
      params: {
        url: imageUrl,
        caption: message,
        access_token: pageAccessToken,
      },
    });
  } catch (error) {
    // Fallback to text-only if photo fails
    return axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, null, {
      params: {
        message,
        access_token: pageAccessToken,
      },
    });
  }
}

app.post('/api/facebook/post', async (req, res) => {
  const { pageId, pageAccessToken, message, topic } = req.body;
  if (!pageId || !pageAccessToken || !message) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const response = await postToFacebook(pageId, pageAccessToken, message, topic || 'news');
    res.json({ success: true, postId: response.data.id || response.data.post_id });
  } catch (error: any) {
    console.error('FB Post Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to post to Facebook' });
  }
});

// --- Autopilot Logic (Refactored for reuse) ---

async function runAutopilotJob() {
  console.log('--- Autopilot Processing Started ---');
  try {
    const autopilotDb = getAutopilotDb();
    const activeConfigs = await autopilotDb.collection('autopostConfigs')
      .where('isActive', '==', true)
      .get();

    console.log(`Found ${activeConfigs.size} active configurations.`);

    for (const doc of activeConfigs.docs) {
      const config = doc.data();
      try {
        console.log(`Processing autopilot for page: ${config.pageName} (${config.pageId})`);
        
        const aiData = await generateAIContent(config.topic, config.language);
        const message = `${aiData.title}\n\n${aiData.content}\n\n${aiData.hashtags.join(' ')}`;
        
        await postToFacebook(config.pageId, config.pageAccessToken, message, config.topic);
        console.log(`Successfully posted for page: ${config.pageId}`);
        
        // Log history in Firestore
        await autopilotDb.collection('autopostConfigs').doc(doc.id).collection('history').add({
          title: aiData.title,
          postedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'success'
        });

      } catch (err: any) {
        console.error(`Autopilot error for page ${config.pageId}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('Global Autopilot Error:', err.message);
  }
}

// --- API endpoint to trigger autopilot manually or via Vercel Cron ---
app.get('/api/autopost/trigger', async (req, res) => {
  // In production, you'd want to secure this with a secret key
  const secret = req.query.secret;
  if (process.env.SESSION_SECRET && secret !== process.env.SESSION_SECRET) {
    return res.status(401).json({ error: 'Unauthorized manual trigger' });
  }

  await runAutopilotJob();
  res.json({ status: 'Autopilot job triggered and processed' });
});

// --- CRON JOB: AUTOPILOT (Twice Day: 10 AM and 10 PM) ---

cron.schedule('0 10,22 * * *', async () => {
  console.log('--- Scheduled Cron Triggered ---');
  await runAutopilotJob();
}, {
  timezone: "Asia/Dhaka"
});

// --- Vite & Static Handling ---

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
