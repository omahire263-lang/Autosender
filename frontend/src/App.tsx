import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Play, Edit3, Users, Settings, Phone, Key, LogOut, MessageCircle, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
axios.defaults.withCredentials = true;

axios.interceptors.request.use(config => {
  const token = localStorage.getItem('tg_session_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type Step = 'PHONE' | 'CODE' | 'DASHBOARD' | 'SAVE_SESSION';
type Group = { id: string; title: string };
type Member = { id: string; username?: string; firstName?: string; status?: string; isBot?: boolean; isDeleted?: boolean; accessHash?: string; };
type MemberStats = { total: number; activeToday: number; activeWeek: number; inactive: number; bots: number; deleted: number; unknown: number; };
type CampaignStatus = {
  id?: number;
  status?: string;
  totalUsers?: number;
  sentCount?: number;
  failedCount?: number;
  message?: string;
  estimatedTime?: number;
  createdAt?: string;
  lastError?: string;
  groupNames?: string[];
  accountStats?: Record<string, number>;
};

type Account = {
  phone: string;
  messagesSent: number;
  isActive: boolean;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
};

function App() {
  const [platform, setPlatform] = useState<'NONE' | 'TELEGRAM' | 'WHATSAPP'>('NONE');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sessionString, setSessionString] = useState('');
  const [step, setStep] = useState<Step>('PHONE');
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardUser, setDashboardUser] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginMethod, setLoginMethod] = useState<'otp' | 'session'>('otp');
  const [loggedInSessionString, setLoggedInSessionString] = useState('');

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [message, setMessage] = useState('Hello! This is a test message.');
  const [durationValue, setDurationValue] = useState<string | number>(3);
  const [durationType, setDurationType] = useState<'hours' | 'minutes'>('hours');
  const [manualDelay, setManualDelay] = useState<string | number>(60);
  const [useManualDelay, setUseManualDelay] = useState(false);
  const [skipCount, setSkipCount] = useState<string | number>(0);
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);


  const [isGroupsLoading, setIsGroupsLoading] = useState(false);
  const [memberStats, setMemberStats] = useState<MemberStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'activeToday' | 'activeWeek' | 'active' | 'unknown'>('all');
  const [allExtractedMembers, setAllExtractedMembers] = useState<Member[]>([]);

  // WhatsApp States
  const [waPhone, setWaPhone] = useState('');
  const [waCode, setWaCode] = useState('');
  const [isWaConnected, setIsWaConnected] = useState(false);
  const [waGroupLink, setWaGroupLink] = useState('');
  const [waExtractedNumbers, setWaExtractedNumbers] = useState<string[]>([]);
  const [isWaExtracting, setIsWaExtracting] = useState(false);
  const [isWaLoading, setIsWaLoading] = useState(false);
  const [waLoginMode, setWaLoginMode] = useState<'PHONE' | 'STRING'>('PHONE');
  const [waSessionString, setWaSessionString] = useState('');
  const [isWaStringLoading, setIsWaStringLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    setIsGroupsLoading(true);
    try {
      const res = await axios.get<{ groups: Group[] }>(`${API_URL}/telegram/groups`);
      setGroups(res.data.groups);
    } catch (error: any) {
      console.error(error);
      alert(`Failed to fetch groups: ${error.response?.data?.error || error.message || 'Server error'}`);
    } finally {
      setIsGroupsLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get<{ status: CampaignStatus | null; isRunning: boolean }>(`${API_URL}/campaign/status`);
      const { status, isRunning } = res.data;
      setCampaignStatus(status || null);
      setIsRunning(isRunning);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await axios.get<{ accounts: Account[]; total: number }>(`${API_URL}/accounts`);
      setAccounts(res.data.accounts);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const switchAccount = async (phone: string) => {
    try {
      await axios.post(`${API_URL}/accounts/switch`, { phone });
      await fetchAccounts();
    } catch (error) {
      alert('Failed to switch account');
    }
  };


  const fetchWaStatus = useCallback(async () => {
    try {
      const res = await axios.get<{ isConnected: boolean }>(`${API_URL}/whatsapp/status`);
      setIsWaConnected(res.data.isConnected);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const initSession = useCallback(async () => {
    setIsLoading(true);

    try {
      const res = await axios.post<{ success: boolean; user?: string; token?: string }>(`${API_URL}/auth/init`);
      if (res.data.token) {
        localStorage.setItem('tg_session_token', res.data.token);
      }
      setDashboardUser(res.data.user || 'User');
      setStep('DASHBOARD');
      await fetchGroups();
      await fetchStatus();
      await fetchAccounts();
      await fetchWaStatus();
    } catch {
      setStep('PHONE');
    } finally {
      setIsLoading(false);
    }
  }, [fetchGroups, fetchStatus, fetchAccounts, fetchWaStatus]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void initSession();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [initSession]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      fetchStatus();
      fetchAccounts();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchAccounts, isRunning]);

  useEffect(() => {
    const handlePopState = () => {
      if (step === 'CODE' || step === 'SAVE_SESSION') {
        setStep('PHONE');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [step]);

  const estimatedDelay = useMemo(() => {
    const val = Number(durationValue) || 0;
    const totalHours = durationType === 'minutes' ? val / 60 : val;
    return members.length ? Math.round((totalHours * 3600) / members.length) : 0;
  }, [durationType, durationValue, members.length]);

  const handleSendCode = async () => {
    try {
      const trimmedPhone = phone.trim();
      const formattedPhone = trimmedPhone.startsWith('+')
        ? trimmedPhone
        : `+91${trimmedPhone.replace(/^0+/, '')}`;

      await axios.post(`${API_URL}/auth/send-code`, { phone: formattedPhone });
      setPhone(formattedPhone);
      setStep('CODE');
      setLoginError('');
      window.history.pushState({ step: 'CODE' }, 'Code');
      alert('OTP sent successfully!');
    } catch (error) {
      alert(`Failed to send code: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const handleLogin = async () => {
    setLoginError('');
    
    if (loginMethod === 'session') {
      // Session-based login
      if (!sessionString) {
        setLoginError('Session string is required');
        alert('Session string is required');
        return;
      }
      try {
        const res = await axios.post<{ success: boolean; user?: string; token?: string }>(`${API_URL}/auth/login`, { phone, sessionString });
        if (res.data.token) {
          localStorage.setItem('tg_session_token', res.data.token);
        }
        setDashboardUser(res.data.user || 'User');
        setStep('DASHBOARD');
      } catch (error) {
        const errorMsg = axios.isAxiosError(error)
          ? error.response?.data?.error || error.message || 'Login failed'
          : 'Login failed. Something went wrong.';
        setLoginError(errorMsg);
        alert(errorMsg);
      }
      return;
    }
    
    // OTP-based login
    try {
      const res = await axios.post<{ success: boolean; user?: string; token?: string; sessionString?: string }>(`${API_URL}/auth/login`, { phone, code });
      if (res.data.token) {
        localStorage.setItem('tg_session_token', res.data.token);
      }
      setDashboardUser(res.data.user || 'User');
      
      // Show session string for backup
      if (res.data.sessionString) {
        setLoggedInSessionString(res.data.sessionString);
      }
      
      setStep('DASHBOARD');
    } catch (error) {
      let errorMsg = axios.isAxiosError(error)
        ? (error.response?.data?.error || error.message || 'Login failed')
        : 'Login failed. Something went wrong.';

      if (axios.isAxiosError(error)) {
        const rawError: string = error.response?.data?.error || error.message || '';
        if (rawError.toUpperCase().includes('PHONE_CODE_INVALID')) {
          errorMsg = '❌ Incorrect OTP! Please check and try again.';
        } else if (rawError.toUpperCase().includes('PHONE_CODE_EXPIRED')) {
          errorMsg = '⏰ OTP expired! Please go back and request a new one.';
        } else if (rawError.toUpperCase().includes('FLOOD_WAIT') || rawError.toUpperCase().includes('A WAIT OF')) {
          const seconds = rawError.match(/\d+/)?.[0] || '';
          errorMsg = `⏳ Too many attempts! Wait ${seconds ? seconds + ' seconds' : 'some time'} and try again.`;
        } else {
          errorMsg = `Login failed: ${rawError || 'Something went wrong'}`;
        }
      }

      setLoginError(errorMsg);
      alert(errorMsg);
    }
  };

  const handleSaveSession = async () => {
    setLoginError('');
    if (!sessionString) {
      setLoginError('Session string is required');
      alert('Session string is required');
      return;
    }
    try {
      const res = await axios.post<{ success: boolean; user?: string; token?: string }>(`${API_URL}/auth/save-session`, { phone, sessionString });
      if (res.data.token) {
        localStorage.setItem('tg_session_token', res.data.token);
      }
      setDashboardUser(res.data.user || 'User');
      setStep('DASHBOARD');
    } catch (error) {
      const errorMsg = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message || 'Failed to save session'
        : 'Failed to save session. Try again.';
      setLoginError(errorMsg);
      alert(errorMsg);
    }
  };

  const extractMembers = async () => {
    if (selectedGroups.length === 0) return alert('Select at least one group');

    try {
      setMembers([]);
      setMemberStats(null);
      setAllExtractedMembers([]);
      const res = await axios.post<{ members: Member[]; stats: MemberStats }>(`${API_URL}/telegram/members`, { groupIds: selectedGroups });
      setAllExtractedMembers(res.data.members);
      setMemberStats(res.data.stats);
      
      const activeMembers = res.data.members.filter(m => m.status === 'activeToday' || m.status === 'activeWeek');
      setMembers(activeMembers);
      setActiveFilter('active');
    } catch (error) {
      alert(`Failed to extract members: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const applyFilter = (filter: 'all' | 'activeToday' | 'activeWeek' | 'active' | 'unknown') => {
    setActiveFilter(filter);
    if (filter === 'all') setMembers(allExtractedMembers);
    else if (filter === 'unknown') setMembers(allExtractedMembers.filter(m => m.status === 'unknown'));
    else if (filter === 'active') setMembers(allExtractedMembers.filter(m => m.status === 'activeToday' || m.status === 'activeWeek'));
    else setMembers(allExtractedMembers.filter(m => m.status === filter));
  };

  const toggleGroup = (id: string) => {
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const startCampaign = async () => {
    if (!members.length) return alert('Extract members first');
    
    const unknownCount = members.filter(m => m.status === 'unknown').length;
    if (unknownCount > 0 && !confirm(`${unknownCount} unknown users included. They may cause PEER_FLOOD errors. Continue?`)) {
      return;
    }

    try {
      const skip = Math.max(0, Number(skipCount) || 0);
      const users = members.filter(member => member.id).map(member => ({ id: member.id, accessHash: member.accessHash, username: member.username }));
      const selectedGroupNames = selectedGroups.map(id => groups.find(g => g.id === id)?.title).filter(Boolean);

      if (useManualDelay) {
        const delaySeconds = Number(manualDelay);
        if (!delaySeconds || delaySeconds <= 0) return alert('Please enter a valid delay in seconds');
        await axios.post(`${API_URL}/campaign/start`, { message, users, groupNames: selectedGroupNames, manualDelaySeconds: delaySeconds, skipCount: skip });
      } else {
        const val = Number(durationValue) || 0;
        const totalTimeHours = durationType === 'minutes' ? val / 60 : val;
        if (totalTimeHours <= 0) return alert('Please enter a valid duration greater than 0');
        await axios.post(`${API_URL}/campaign/start`, { message, users, groupNames: selectedGroupNames, totalTimeHours, skipCount: skip });
      }

      setIsRunning(true);
      await fetchStatus();
    } catch (error) {
      alert(`Failed to start campaign: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };



  const closeAllCampaigns = async () => {
    try {
      await axios.post(`${API_URL}/campaign/stop-all`);
      setIsRunning(false);
      await fetchStatus();
    } catch (error) {
      console.error(error);
    }
  };

  const handleWaPair = async () => {
    if (!waPhone) return alert('Enter phone number');
    setIsWaLoading(true);
    try {
      const trimmedPhone = waPhone.trim();
      const formattedPhone = trimmedPhone.startsWith('+')
        ? trimmedPhone
        : `+91${trimmedPhone.replace(/^0+/, '')}`;

      const res = await axios.post<{ code: string }>(`${API_URL}/whatsapp/auth/pair`, { phone: formattedPhone });
      setWaCode(res.data.code);
      
      const interval = setInterval(async () => {
        try {
          const st = await axios.get(`${API_URL}/whatsapp/status`);
          if (st.data.isConnected) {
            clearInterval(interval);
            setStep('DASHBOARD');
            await fetchWaStatus();
          }
        } catch(e){}
      }, 5000);
    } catch (error) {
      alert(`Failed to get pairing code: ${getErrorMessage(error, 'Error')}`);
    } finally {
      setIsWaLoading(false);
    }
  };

  const handleWaStringLogin = async () => {
    if (!waSessionString.trim()) {
      alert('Please enter a session string');
      return;
    }
    setIsWaStringLoading(true);
    try {
      await axios.post(`${API_URL}/whatsapp/auth/login-session`, { sessionString: waSessionString.trim() });
      setStep('DASHBOARD');
      await fetchWaStatus();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to login with session string');
    } finally {
      setIsWaStringLoading(false);
    }
  };

  const copyWaSessionString = async () => {
    try {
      const res = await axios.get<{sessionString: string}>(`${API_URL}/whatsapp/auth/session-string`);
      await navigator.clipboard.writeText(res.data.sessionString);
      alert('WhatsApp Session String Copied to Clipboard! Save it securely.');
    } catch (error: any) {
      alert('Failed to export session string: ' + (error.response?.data?.error || error.message));
    }
  };

  const extractWaGroupMembers = async () => {
    if (!waGroupLink.trim()) return alert('Please enter a group link');
    setIsWaExtracting(true);
    setWaExtractedNumbers([]);
    try {
      const res = await axios.post(`${API_URL}/whatsapp/extract-group`, { link: waGroupLink.trim() });
      setWaExtractedNumbers(res.data.members || []);
      alert(`Extracted ${res.data.participantCount} members from ${res.data.subject || 'group'}!`);
    } catch (error: any) {
      alert(`Extraction failed: ${error.response?.data?.error || error.message}`);
    } finally {
      setIsWaExtracting(false);
    }
  };

  const copyExtractedNumbers = async () => {
    if (!waExtractedNumbers.length) return;
    try {
      await navigator.clipboard.writeText(waExtractedNumbers.join('\n'));
      alert('Numbers copied to clipboard!');
    } catch (err) {
      alert('Failed to copy numbers');
    }
  };

  const updateMessage = async () => {
    try {
      await axios.post(`${API_URL}/campaign/update-message`, { message });
      alert('Message updated live!');
    } catch (error) {
      console.error(error);
    }
  };

  const updateDelay = async () => {
    const delaySeconds = Number(manualDelay);
    if (!delaySeconds || delaySeconds <= 0) return alert('Enter a valid delay in seconds');
    try {
      await axios.post(`${API_URL}/campaign/update-delay`, { delaySeconds });
      alert(`Delay updated to ${delaySeconds} seconds!`);
    } catch (error) {
      alert(`Failed to update delay: ${getErrorMessage(error, 'Something went wrong')}`);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`);
    } catch (error) {
      console.error(error);
    } finally {
      localStorage.removeItem('tg_session_token');
      setStep('PHONE');
      setDashboardUser('');
      setGroups([]);
      setSelectedGroups([]);
      setMembers([]);
      
      setIsRunning(false);
    }
  };

if (platform === 'NONE') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white text-gray-900 p-4">
        <h1 className="text-4xl font-extrabold mb-12 text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-green-600 text-center">
          Choose Platform
        </h1>
        <div className="flex flex-col sm:flex-row gap-6 w-full max-w-3xl">
          <button 
            onClick={() => setPlatform('TELEGRAM')}
            className="flex-1 bg-white border border-blue-300 hover:border-blue-500 p-10 rounded-3xl flex flex-col items-center justify-center gap-6 transition-all group shadow-lg"
          >
            <div className="p-6 bg-blue-100 rounded-full group-hover:scale-110 transition-transform">
              <Users size={64} className="text-blue-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800">Telegram</h2>
            <p className="text-gray-600 text-center text-sm px-4">Automate group extractions and bulk messaging securely.</p>
          </button>

          <button 
            onClick={() => setPlatform('WHATSAPP')}
            className="flex-1 bg-white border border-green-300 hover:border-green-500 p-10 rounded-3xl flex flex-col items-center justify-center gap-6 transition-all group shadow-lg"
          >
            <div className="p-6 bg-green-100 rounded-full group-hover:scale-110 transition-transform">
              <MessageCircle size={64} className="text-green-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800">WhatsApp</h2>
            <p className="text-gray-600 text-center text-sm px-4">Link via phone number (8-digit code) and automate campaigns.</p>
          </button>
        </div>
      </div>
    );
  }

  if (platform === 'WHATSAPP') {
    return (
      <div className="min-h-screen bg-gray-100 text-gray-900 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-green-700 flex items-center gap-3">
              <MessageCircle className="text-green-500" size={32} /> WhatsApp Extractor
            </h1>
            <div className="flex gap-3 items-center">
              <button onClick={() => { setStep('PHONE'); setPlatform('NONE'); }} className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-semibold transition-colors">
                Back Home
              </button>
              {isWaConnected && (
                <button onClick={copyWaSessionString} className="flex items-center gap-2 bg-green-100 hover:bg-green-200 text-green-800 px-4 py-2 rounded-lg font-semibold transition-colors">
                  Copy Session
                </button>
              )}
            </div>
          </div>

          {!isWaConnected && (
             <div className="bg-red-100 border border-red-300 text-red-700 p-4 rounded-xl text-center font-bold">
                ⚠️ Backend Bot is not connected to WhatsApp! Extraction will fail until an admin connects a WhatsApp account.
             </div>
          )}

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:col-span-2 max-w-2xl mx-auto w-full">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-900"><Users className="text-green-500" /> Extract Group Members</h2>
            
            <label className="block text-sm text-gray-600 mb-2 font-medium">WhatsApp Group Invite Link:</label>
            <input
              type="text"
              value={waGroupLink} onChange={e => setWaGroupLink(e.target.value)}
              className="w-full bg-gray-100 border border-gray-300 text-gray-900 p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
              placeholder="https://chat.whatsapp.com/..."
            />

            <button 
              onClick={extractWaGroupMembers} 
              disabled={isWaExtracting}
              className="w-full bg-green-600 hover:bg-green-700 text-white p-4 rounded-lg font-bold transition-colors shadow-sm disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {isWaExtracting ? 'Extracting...' : 'Extract Members'}
            </button>

            {waExtractedNumbers.length > 0 && (
              <div className="mt-6">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-600 font-medium">Extracted Numbers ({waExtractedNumbers.length}):</label>
                  <button onClick={copyExtractedNumbers} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded font-semibold transition-colors">
                    Copy All
                  </button>
                </div>
                <textarea
                  readOnly
                  value={waExtractedNumbers.join('\n')}
                  className="w-full h-48 bg-gray-50 border border-gray-300 text-gray-800 p-3 rounded-lg focus:outline-none resize-y text-sm font-mono"
                ></textarea>
              </div>
            )}
          </div>

          {!isWaConnected && (
             <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col max-w-2xl mx-auto w-full mt-8">
               <h3 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2">Admin: Connect Bot</h3>
               
               {waCode ? (
                  <div className="mb-6">
                    <p className="text-gray-600 mb-4">Your Pairing Code:</p>
                    <div className="text-4xl font-mono tracking-widest font-black text-green-700 bg-green-50 p-4 rounded-xl border-2 border-green-200 text-center">
                      {waCode}
                    </div>
                    <p className="text-sm text-gray-500 mt-4 text-center">Enter this code in your WhatsApp linked devices. Waiting for connection...</p>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-lg">
                      <button
                        onClick={() => setWaLoginMode('PHONE')}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${waLoginMode === 'PHONE' ? 'bg-white shadow text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        Pairing Code
                      </button>
                      <button
                        onClick={() => setWaLoginMode('STRING')}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${waLoginMode === 'STRING' ? 'bg-white shadow text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        Session String
                      </button>
                    </div>

                    {waLoginMode === 'PHONE' ? (
                      <>
                        <input type="text" placeholder="Phone Number (e.g. +91...)"
                          value={waPhone} onChange={e => setWaPhone(e.target.value)}
                          className="w-full bg-gray-100 p-4 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 placeholder-gray-500"
                        />
                        <button 
                          onClick={handleWaPair}
                          disabled={isWaLoading}
                          className="w-full bg-gray-800 text-white hover:bg-gray-900 p-4 rounded-xl font-bold transition-colors disabled:opacity-50">
                          {isWaLoading ? 'Requesting Code...' : 'Get 8-Digit Pairing Code'}
                        </button>
                      </>
                    ) : (
                      <>
                        <textarea
                          placeholder="Paste Session String..."
                          value={waSessionString}
                          onChange={e => setWaSessionString(e.target.value)}
                          className="w-full bg-gray-100 p-4 rounded-xl mb-4 h-32 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 placeholder-gray-500 resize-none text-xs"
                        />
                        <button 
                          onClick={handleWaStringLogin}
                          disabled={isWaStringLoading}
                          className="w-full bg-green-600 text-white hover:bg-green-700 p-4 rounded-xl font-bold transition-colors disabled:opacity-50">
                          {isWaStringLoading ? 'Logging In...' : 'Login with Session String'}
                        </button>
                      </>
                    )}
                  </>
                )}
             </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-900">
        Loading...
      </div>
    );
  }

if (step === 'PHONE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-xl w-96 border border-gray-300">
          <div className="flex justify-center mb-6"><Phone size={48} className="text-blue-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Telegram Login</h2>

          <div className="mb-6">
            <label className="block text-sm text-gray-600 mb-2">Login with OTP</label>
            <input type="text" placeholder="Phone Number (e.g. +123456789)"
              className="w-full bg-gray-100 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
              value={phone} onChange={e => setPhone(e.target.value)} />
            <button onClick={handleSendCode} className="w-full bg-blue-600 text-white hover:bg-blue-700 p-3 rounded font-semibold transition-colors">
              Send Code
            </button>
          </div>

          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-gray-300"></div>
            <span className="px-4 text-gray-500 text-sm font-semibold">OR</span>
            <div className="flex-1 border-t border-gray-300"></div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">Login with Backup String</label>
            <input type="password" placeholder="Paste Session String (317...)"
              className="w-full bg-gray-100 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 placeholder-gray-500 font-mono text-sm"
              value={sessionString} onChange={e => setSessionString(e.target.value)} />
            <button onClick={() => { setLoginMethod('session'); setTimeout(handleLogin, 50); }} className="w-full bg-green-600 text-white hover:bg-green-700 p-3 rounded font-semibold transition-colors flex items-center justify-center gap-2">
              <Key size={18} /> Login with Session String
            </button>
          </div>
        </div>
      </div>
    );
  }

if (step === 'SAVE_SESSION') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-xl w-96 border border-gray-300">
          <div className="flex justify-center mb-6"><Key size={48} className="text-purple-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Save Session</h2>
          {loginError && (
            <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm font-medium border border-red-300">
              {loginError}
            </div>
          )}
          <input type="text" placeholder="Phone (optional)"
            className="w-full bg-gray-100 p-3 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 placeholder-gray-500"
            value={phone} onChange={e => setPhone(e.target.value)} />
          <input type="password" placeholder="Session String (317XXXXXXXXXXXXXXX...)"
            className="w-full bg-gray-100 p-3 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 placeholder-gray-500 font-mono text-sm"
            value={sessionString} onChange={e => setSessionString(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => setStep('PHONE')} className="flex-1 bg-gray-200 text-gray-700 hover:bg-gray-300 p-2 rounded transition-colors">
              Back
            </button>
            <button onClick={handleSaveSession} className="flex-1 bg-purple-600 text-white hover:bg-purple-700 p-3 rounded font-semibold transition-colors">
              Save & Connect
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'CODE') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-900">
        <div className="bg-white p-8 rounded-xl shadow-xl w-96 border border-gray-300">
          <div className="flex justify-center mb-6"><Key size={48} className="text-blue-500" /></div>
          <h2 className="text-2xl font-bold mb-6 text-center">Enter Code</h2>
          {loginError && (
            <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm font-medium border border-red-300">
              {loginError}
            </div>
          )}
          <input type="text" placeholder="5-digit code"
            className="w-full bg-gray-100 p-3 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
            value={code} onChange={e => setCode(e.target.value)} />
          <button onClick={handleLogin} className="w-full bg-blue-600 text-white hover:bg-blue-700 p-3 rounded font-semibold transition-colors">
            Login
          </button>
        </div>
      </div>
    );
  }

return (
    <div className="min-h-screen bg-gray-100 text-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 flex items-center gap-3">
            <Users className="text-blue-400" size={32} /> Auto-Sender
          </h1>
          <div className="flex gap-2">
            <button onClick={() => setStep('PHONE')} className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow-sm">
              + Add Account
            </button>
            <button onClick={handleLogout} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold transition-colors">
              <LogOut size={18} /> Logout
            </button>
          </div>
        </div>

        {dashboardUser && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row items-center justify-between bg-white p-4 rounded-lg border border-gray-200">
              <p className="text-gray-500 text-center sm:text-left mb-4 sm:mb-0">Logged in as: <span className="text-gray-900 font-semibold">{dashboardUser}</span></p>
              {loggedInSessionString && (
                <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                  <input type="password" readOnly value={loggedInSessionString} className="bg-gray-100 border border-gray-300 rounded p-2 text-sm text-gray-500 w-full sm:w-48 font-mono outline-none" placeholder="Session String" />
                  <button onClick={() => { navigator.clipboard.writeText(loggedInSessionString); alert('Copied to clipboard!'); }} className="bg-purple-600 text-white px-3 py-2 rounded text-sm font-semibold hover:bg-purple-700 transition-colors whitespace-nowrap flex items-center gap-1">
                    <Key size={14}/> Copy Session
                  </button>
                </div>
              )}
            </div>

            {accounts.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between bg-white p-4 rounded-lg border border-gray-200">
                <p className="text-gray-500 font-semibold shrink-0">Accounts ({accounts.length}):</p>
                <div className="flex gap-2 flex-wrap mt-2 sm:mt-0 sm:ml-4 overflow-x-auto pb-1">
                  {accounts.map(acc => (
                    <button
                      key={acc.phone}
                      onClick={() => switchAccount(acc.phone)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${acc.isActive ? 'bg-green-100 text-green-800 border-2 border-green-400 shadow-sm' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
                    >
                      {acc.phone} <span className="opacity-75 font-normal ml-1">(Sent: {acc.messagesSent})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col" style={{minHeight: '420px'}}>
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900"><Users className="text-blue-400" /> Target Audience</h2>
              <button onClick={fetchGroups} className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-gray-600 font-medium">
                {isGroupsLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {groups.length > 0 && (
              <div className="flex items-center justify-between mb-2 shrink-0">
                <span className="text-xs text-gray-500">{selectedGroups.length}/{groups.length} selected</span>
                <button
                  onClick={() => selectedGroups.length === groups.length ? setSelectedGroups([]) : setSelectedGroups(groups.map(g => g.id))}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                >
                  {selectedGroups.length === groups.length ? '☑ Deselect All' : '☐ Select All'}
                </button>
              </div>
            )}

            <div className="overflow-y-auto bg-gray-100 rounded p-3 mb-3 space-y-2 border border-gray-300" style={{height: '185px'}}>
              {isGroupsLoading ? (
                <p className="text-gray-500 text-sm text-center py-4">Fetching groups from all accounts...</p>
              ) : groups.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No groups found.</p>
              ) : (
                groups.map(g => (
                  <label key={g.id} className="flex items-center gap-3 p-2 hover:bg-gray-200 rounded cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded border-gray-500 text-blue-400 focus:ring-blue-500 bg-gray-100"
                      checked={selectedGroups.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span className="text-sm text-gray-800 truncate select-none">{g.title}</span>
                  </label>
                ))
              )}
            </div>

            <button onClick={extractMembers} disabled={isGroupsLoading || selectedGroups.length === 0} className="w-full shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 p-3 rounded text-gray-800 font-semibold transition-colors">
              Extract Members {selectedGroups.length > 0 ? `(${selectedGroups.length} groups)` : ''}
            </button>
            {memberStats && (
              <div className="mt-3">
                <div className="grid grid-cols-3 gap-1 mb-3 text-center text-xs">
                  <div className="bg-green-50 border border-green-200 p-2 rounded-lg">
                    <p className="text-lg font-bold text-green-600">{memberStats.activeToday}</p>
                    <p className="text-green-700">🟢 Active Today</p>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 p-2 rounded-lg">
                    <p className="text-lg font-bold text-yellow-600">{memberStats.activeWeek}</p>
                    <p className="text-yellow-700">🟡 This Week</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 p-2 rounded-lg">
                    <p className="text-lg font-bold text-gray-500">{memberStats.inactive + memberStats.unknown}</p>
                    <p className="text-gray-500">🔴 Inactive</p>
                  </div>
                </div>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {(['all','active','activeToday','activeWeek'] as const).map(f => (
                    <button key={f} onClick={() => applyFilter(f)}
                      className={`text-xs px-2 py-1 rounded font-semibold transition-colors ${activeFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {f === 'all' ? `All (${allExtractedMembers.length})` : f === 'active' ? `✅ Active Only (${memberStats.activeToday + memberStats.activeWeek})` : f === 'activeToday' ? `🟢 Today (${memberStats.activeToday})` : `🟡 Week (${memberStats.activeWeek})`}
                    </button>
                  ))}
                </div>
                <p className="text-blue-600 font-semibold text-center mb-2">✅ Ready: {members.length} Users</p>
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={Number(skipCount) > 0}
                    onChange={e => setSkipCount(e.target.checked ? 1 : 0)}
                    className="w-4 h-4 rounded border-gray-500 text-blue-400"
                  />
                  <span className="text-xs text-gray-600 font-medium">Skip starting members</span>
                </label>
                {Number(skipCount) > 0 && (
                  <div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Skip first</label>
                      <input
                        type="number" min={1} max={members.length - 1} value={skipCount}
                        onChange={e => setSkipCount(e.target.value)}
                        className="w-20 bg-gray-100 border border-gray-300 text-gray-900 p-1.5 rounded text-sm outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <label className="text-xs text-gray-500 font-medium whitespace-nowrap">members</label>
                    </div>
                    <p className="text-xs text-orange-400 mt-1">⚠️ First {skipCount} skipped. Sending to {members.length - Number(skipCount)} members. Counter: {skipCount}/{members.length}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
             <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-900"><Settings className="text-purple-400" /> Settings</h2>

             {/* Mode Toggle */}
             <div className="flex gap-2 mb-4 bg-gray-100 p-1 rounded-lg">
               <button
                 onClick={() => setUseManualDelay(false)}
                 className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-colors ${!useManualDelay ? 'bg-gray-200 shadow text-purple-400' : 'text-gray-500'}`}
               >
                 ⏱ Auto (Hours/Min)
               </button>
               <button
                 onClick={() => setUseManualDelay(true)}
                 className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-colors ${useManualDelay ? 'bg-gray-200 shadow text-orange-400' : 'text-gray-500'}`}
               >
                 ⚡ Manual (Seconds)
               </button>
             </div>

             {useManualDelay ? (
               /* Manual Delay Mode */
               <div>
                 <label className="block text-gray-600 font-medium text-sm mb-2">Delay Between Messages (seconds)</label>
                 <input type="number" min={1} step={1} value={manualDelay} onChange={e => setManualDelay(e.target.value)}
                   className="w-full bg-gray-100 border border-gray-300 text-gray-900 p-3 rounded mb-3 outline-none focus:ring-2 focus:ring-orange-400" />
                 {isRunning && (
                   <button onClick={updateDelay} className="w-full bg-orange-900 text-orange-300 hover:bg-orange-800 p-2 rounded font-semibold text-sm transition-colors">
                     🔄 Update Delay Live
                   </button>
                 )}
                 <p className="text-xs text-gray-500 mt-2">Campaign chalte waqt bhi delay change kar sakte ho</p>
               </div>
             ) : (
               /* Auto Duration Mode */
               <div>
                 <div className="flex gap-4 mb-4">
                   <label className="flex items-center gap-2 cursor-pointer">
                     <input type="radio" className="text-purple-400 focus:ring-purple-500 bg-gray-100 border-gray-500" checked={durationType === 'hours'} onChange={() => setDurationType('hours')} />
                     <span className="text-sm text-gray-600 font-medium">Hours</span>
                   </label>
                   <label className="flex items-center gap-2 cursor-pointer">
                     <input type="radio" className="text-purple-400 focus:ring-purple-500 bg-gray-100 border-gray-500" checked={durationType === 'minutes'} onChange={() => setDurationType('minutes')} />
                     <span className="text-sm text-gray-600 font-medium">Minutes</span>
                   </label>
                 </div>
                 <label className="block text-gray-600 font-medium text-sm mb-2">Duration ({durationType === 'hours' ? 'Hours' : 'Minutes'})</label>
                 <input type="number" min={0.1} step={0.1} value={durationValue} onChange={e => setDurationValue(e.target.value)}
                   className="w-full bg-gray-100 border border-gray-300 text-gray-900 p-3 rounded mb-4 outline-none focus:ring-2 focus:ring-purple-500" />
                 <label className="block text-gray-600 font-medium text-sm mb-2">Estimated Delay</label>
                 <div className="bg-blue-900 border border-blue-700 p-3 rounded text-blue-300 font-mono font-medium">
                   {members.length ? estimatedDelay : 0} seconds / msg
                 </div>
               </div>
             )}
           </div>

           <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2">
             <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-900"><Edit3 className="text-green-400" /> Message Template</h2>
             <textarea
               value={message} onChange={e => setMessage(e.target.value)}
               className="w-full h-32 bg-gray-100 border border-gray-300 text-gray-900 p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 mb-4 resize-none"
               placeholder="Type your message here..."></textarea>

             <button onClick={updateMessage} className="bg-green-900 text-green-300 hover:bg-green-800 px-6 py-2 rounded-lg font-semibold transition-colors">
               Save Changes Live
             </button>
           </div>

           <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm md:col-span-2 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h2 className="text-2xl font-bold mb-2 text-gray-900">Campaign Status</h2>
                 {campaignStatus ? (
                  <div>
                    <p className={`font-bold mb-2 ${campaignStatus.status?.includes('Paused') ? 'text-orange-500' : 'text-green-600'}`}>
                      {campaignStatus.status?.includes('Paused') ? 'Campaign Paused (Flood Restrict)' : 'Campaign Running'}
                    </p>
                    <div className="text-sm bg-gray-50 p-3 rounded border border-gray-200 mb-2">
                       {campaignStatus.groupNames && campaignStatus.groupNames.length > 0 && (
                         <div className="mb-2 pb-2 border-b border-gray-200">
                           <p className="font-semibold text-blue-700 text-xs uppercase tracking-wider mb-1">Target Groups ({campaignStatus.groupNames.length}):</p>
                           <p className="text-gray-700 font-medium text-xs truncate w-48 sm:w-64">{campaignStatus.groupNames.join(', ')}</p>
                         </div>
                       )}
                       <p className="font-semibold truncate w-48 sm:w-64 mb-1">{campaignStatus.message}</p>
                       <p className="text-gray-600">Sent: {campaignStatus.sentCount || 0} / {campaignStatus.totalUsers || 0} | Failed: <span className="text-red-500 font-bold">{campaignStatus.failedCount || 0}</span></p>
                       
                       {campaignStatus.accountStats && Object.keys(campaignStatus.accountStats).length > 0 && (
                         <div className="mt-2 bg-white border border-gray-200 p-2 rounded text-xs">
                           <span className="font-bold text-gray-700 block mb-1">Sent by Account (This Campaign):</span>
                           <div className="flex flex-wrap gap-2">
                             {Object.entries(campaignStatus.accountStats).map(([phone, count]) => (
                               <div key={phone} className="bg-gray-100 px-2 py-1 rounded text-gray-600">
                                 {phone}: <span className="font-semibold text-green-700">{count}</span>
                               </div>
                             ))}
                           </div>
                         </div>
                       )}

                       {campaignStatus.lastError && (
                         <div className="mt-2 bg-red-100 border border-red-300 p-2 rounded text-xs text-red-700">
                           <span className="font-bold">Error:</span> {campaignStatus.lastError}
                         </div>
                       )}
                    </div>
                  </div>
                ) : <p className="text-gray-500">No active campaigns</p>}
              </div>

              <div className="flex flex-col gap-4 w-full md:w-auto">
                {!isRunning && (
                  <button onClick={startCampaign} className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 px-8 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(37,99,235,0.39)]">
                    <Play fill="currentColor" /> Start Sender
                  </button>
                )}
                {campaignStatus && isRunning && (
                  <div className="flex gap-2">
                    <button onClick={closeAllCampaigns} className="w-full flex items-center justify-center gap-2 bg-gray-800 text-white hover:bg-gray-900 px-6 py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-[0_4px_14px_0_rgba(31,41,55,0.39)]">
                      <X fill="currentColor" /> Close
                    </button>
                  </div>
                )}
              </div>
            </div>

         </div>
       </div>
     </div>
   );
}

export default App;
