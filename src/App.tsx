/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Facebook, 
  Settings, 
  PlusCircle, 
  RefreshCcw, 
  Send, 
  LayoutDashboard, 
  LogOut, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  Clock,
  Sparkles,
  Search,
  Globe
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

interface AIContent {
  title: string;
  content: string;
  hashtags: string[];
  imagePrompt: string;
}

interface PostHistory {
  id: string;
  title: string;
  date: string;
  status: 'published' | 'failed' | 'scheduled';
}

interface AutopilotConfig {
  pageId: string;
  pageName: string;
  topic: string;
  language: string;
  isActive: boolean;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<FacebookPage | null>(null);
  const [topic, setTopic] = useState('Technology & AI');
  const [language, setLanguage] = useState('Bengali');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentAIContent, setCurrentAIContent] = useState<AIContent | null>(null);
  const [history, setHistory] = useState<PostHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autopilotConfigs, setAutopilotConfigs] = useState<AutopilotConfig[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Authentication & Initial Data Fetching
  useEffect(() => {
    checkAuthStatus();
    
    // Listen for OAuth success from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        checkAuthStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPages();
      fetchAutopilotConfigs();
    }
  }, [isAuthenticated]);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/facebook/status');
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
    } catch (err) {
      console.error('Auth check error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPages = async () => {
    try {
      const res = await fetch('/api/facebook/pages');
      if (res.ok) {
        const data = await res.json();
        setPages(data);
        if (data.length > 0) {
          setSelectedPage(data[0]);
        }
      }
    } catch (err) {
      console.error('Fetch pages error:', err);
    }
  };

  const fetchAutopilotConfigs = async () => {
    try {
      const res = await fetch('/api/autopost/config');
      if (res.ok) {
        const data = await res.json();
        setAutopilotConfigs(data);
        // If we have a config for a page, update the local state to match
        if (selectedPage) {
          const config = data.find((c: any) => c.pageId === selectedPage.id);
          if (config) {
            setTopic(config.topic);
            setLanguage(config.language);
          }
        }
      }
    } catch (err) {
      console.error('Fetch configs error:', err);
    }
  };

  const handleSaveAutopilot = async (active: boolean) => {
    if (!selectedPage) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/autopost/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: selectedPage.id,
          pageAccessToken: selectedPage.access_token,
          pageName: selectedPage.name,
          topic,
          language,
          isActive: active
        }),
      });
      if (!res.ok) throw new Error('Failed to save autopilot settings');
      await fetchAutopilotConfigs();
      alert(`Autopilot ${active ? 'Enabled' : 'Disabled'} for ${selectedPage.name}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/facebook/url');
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start login process');
      }
      
      if (!data.url) {
        throw new Error('No login URL returned from server');
      }

      window.open(data.url, 'fb_oauth', 'width=600,height=700');
    } catch (err: any) {
      setError(err.message || 'Failed to start login process');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/facebook/logout', { method: 'POST' });
    setIsAuthenticated(false);
    setPages([]);
    setSelectedPage(null);
  };

  const generateContent = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, language }),
      });
      if (!res.ok) throw new Error('Failed to generate content');
      const data = await res.json();
      setCurrentAIContent(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePost = async () => {
    if (!selectedPage || !currentAIContent) return;
    
    setIsLoading(true);
    try {
      const message = `${currentAIContent.title}\n\n${currentAIContent.content}\n\n${currentAIContent.hashtags.join(' ')}`;
      const res = await fetch('/api/facebook/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: selectedPage.id,
          pageAccessToken: selectedPage.access_token,
          message,
          topic,
        }),
      });

      if (!res.ok) throw new Error('Failed to post to Facebook');
      
      const newPost: PostHistory = {
        id: Math.random().toString(36).substr(2, 9),
        title: currentAIContent.title,
        date: new Date().toLocaleString(),
        status: 'published'
      };
      setHistory([newPost, ...history]);
      setCurrentAIContent(null);
      alert('Post successful!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <RefreshCcw className="w-8 h-8 animate-spin text-brand" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Navigation */}
      <nav className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-brand text-white p-2 rounded-lg">
              <Sparkles className="w-6 h-6" />
            </div>
            <span className="font-bold text-xl tracking-tight hidden sm:block">SocialAgent AI</span>
          </div>
          
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <button 
                onClick={handleLogout}
                className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition-colors text-sm font-medium"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg font-medium hover:bg-brand/90 transition-colors shadow-sm"
              >
                <Facebook className="w-4 h-4" />
                Connect Facebook
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Settings & Controls */}
        <div className="lg:col-span-4 space-y-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-6 rounded-2xl border shadow-sm space-y-6"
          >
            <div className="flex items-center gap-2 text-gray-800 font-semibold mb-4">
              <Settings className="w-5 h-5" />
              Agent Settings
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Search className="w-4 h-4" /> Content Niche / Topic
                </label>
                <input 
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Health tips, Stock market, Tech news"
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Globe className="w-4 h-4" /> Language
                </label>
                <select 
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-white focus:ring-2 focus:ring-brand outline-none"
                >
                  <option value="Bengali">Bengali (বাংলা)</option>
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4" /> Select Page
                </label>
                {isAuthenticated ? (
                  pages.length > 0 ? (
                    <select 
                      value={selectedPage?.id || ''}
                      onChange={(e) => setSelectedPage(pages.find(p => p.id === e.target.value) || null)}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-white"
                    >
                      {pages.map(page => (
                        <option key={page.id} value={page.id}>{page.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-100 italic">
                      No Facebook pages found for this account.
                    </p>
                  )
                ) : (
                  <p className="text-xs text-gray-500 italic p-3 bg-gray-50 rounded-lg border">
                    Connect Facebook to see your pages.
                  </p>
                )}
              </div>
            </div>

            <button 
              disabled={!isAuthenticated || isGenerating}
              onClick={generateContent}
              className={cn(
                "w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]",
                isAuthenticated && !isGenerating 
                  ? "bg-gradient-to-r from-brand to-blue-700 text-white hover:shadow-lg" 
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              {isGenerating ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
              {isGenerating ? "Analyzing Web..." : "Scout Content Now"}
            </button>

            {isAuthenticated && selectedPage && (
              <div className="pt-4 border-t space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Autopilot Controls</p>
                {autopilotConfigs.find(c => c.pageId === selectedPage.id)?.isActive ? (
                  <button 
                    disabled={isSaving}
                    onClick={() => handleSaveAutopilot(false)}
                    className="w-full py-3 rounded-xl bg-red-50 text-red-600 font-bold flex items-center justify-center gap-2 border border-red-100 hover:bg-red-100 transition-colors"
                  >
                    <Clock className="w-4 h-4" />
                    Stop Autopilot
                  </button>
                ) : (
                  <button 
                    disabled={isSaving}
                    onClick={() => handleSaveAutopilot(true)}
                    className="w-full py-3 rounded-xl bg-green-50 text-green-700 font-bold flex items-center justify-center gap-2 border border-green-100 hover:bg-green-100 transition-colors"
                  >
                    <Clock className="w-4 h-4" />
                    Start Autopilot
                  </button>
                )}
                <p className="text-[10px] text-gray-400 text-center italic">
                  Autopilot posts twice daily using your saved topic.
                </p>
              </div>
            )}
          </motion.div>

          {/* Stats Widget */}
          <div className="bg-brand text-white p-6 rounded-2xl shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <TrendingUp className="w-6 h-6" />
              <span className="text-xs opacity-75 font-mono">LIVE OPTIMIZER</span>
            </div>
            <div>
              <p className="text-3xl font-bold">
                {autopilotConfigs.filter(c => c.isActive).length > 0 ? "Autopilot" : "Manual"}
              </p>
              <p className="text-sm opacity-90">
                {autopilotConfigs.filter(c => c.isActive).length} active automation{autopilotConfigs.filter(c => c.isActive).length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm bg-white/20 p-2 rounded-lg">
              <Clock className="w-4 h-4" />
              <span>Posts at 10 AM & 10 PM</span>
            </div>
          </div>
        </div>

        {/* Right Column: Content Preview & History */}
        <div className="lg:col-span-8 space-y-8">
          
          <AnimatePresence mode="wait">
            {currentAIContent ? (
              <motion.div 
                key="preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl border shadow-lg overflow-hidden"
              >
                <div className="bg-gray-50 p-4 border-b flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedPage ? (
                      <div className="w-10 h-10 bg-brand/10 text-brand rounded-full flex items-center justify-center font-bold">
                        {selectedPage.name[0]}
                      </div>
                    ) : (
                      <div className="w-10 h-10 bg-gray-200 rounded-full" />
                    )}
                    <div>
                      <p className="font-bold text-sm">{selectedPage?.name || 'Your Page'}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold flex items-center gap-1">
                        <Sparkles className="w-2 h-2" /> AI Draft
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setCurrentAIContent(null)}
                    className="text-gray-400 hover:text-gray-600 p-2"
                  >
                    ×
                  </button>
                </div>

                <div className="p-8 space-y-6">
                  <h2 className="text-2xl font-bold text-gray-900 leading-tight">
                    {currentAIContent.title}
                  </h2>
                  <div className="prose prose-blue text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 p-6 rounded-2xl border border-dashed border-gray-200">
                    {currentAIContent.content}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {currentAIContent.hashtags.map((tag, idx) => (
                      <span key={idx} className="bg-blue-50 text-brand px-3 py-1 rounded-full text-xs font-semibold">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-amber-500 mt-1" />
                    <div>
                      <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">AI Suggestion</p>
                      <p className="text-sm text-amber-700 italic">"Use a vibrant, high-contrast {currentAIContent.imagePrompt.toLowerCase()} image for maximum engagement."</p>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-gray-50 border-t flex gap-4">
                  <button 
                    onClick={handlePost}
                    className="flex-1 bg-brand text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 active:scale-95"
                  >
                    <Send className="w-5 h-5" />
                    Post to Facebook Page
                  </button>
                  <button 
                    onClick={generateContent}
                    className="px-6 py-4 rounded-2xl bg-white border border-gray-200 font-bold text-gray-600 hover:bg-gray-100 transition-all active:scale-95"
                  >
                    Regenerate
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-3xl h-64 flex flex-center items-center justify-center p-8 text-center"
              >
                <div className="space-y-4 max-w-sm">
                  <div className="bg-white p-4 rounded-2xl w-fit mx-auto shadow-sm">
                    <LayoutDashboard className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="font-bold text-gray-800">Your content feed is empty</h3>
                  <p className="text-sm text-gray-600">
                    Click "Scout Content Now" to let AI find trending news for you to post.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          {error && (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-red-50 text-red-600 p-4 rounded-2xl border border-red-100 flex items-center gap-3"
            >
              <AlertCircle className="w-5 h-5" />
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}

          {/* History */}
          <div className="space-y-4">
            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2 px-2">
              <RefreshCcw className="w-5 h-5 text-gray-400" /> Recent Activity
            </h3>
            <div className="bg-white border rounded-2xl overflow-hidden divide-y">
              {history.length > 0 ? (
                history.map(post => (
                  <div key={post.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="bg-green-100 text-green-600 p-2 rounded-lg">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-gray-900">{post.title}</p>
                        <p className="text-xs text-gray-500">{post.date}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">
                      {post.status}
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-gray-500 italic text-sm">
                  No post history yet. Start growing your reach today!
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="fixed bottom-0 left-0 right-0 py-4 bg-white/80 backdrop-blur-md border-t text-center text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold">
        Powered by Gemini 3.0 • Real-time Social Trends Optimizer
      </footer>
    </div>
  );
}
