/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Star, Check, RotateCcw, FastForward, Play, Pause, Filter, Search, 
  MapPin, DollarSign, Calendar, Sparkles, BookOpen, Award, Copy, Volume2, 
  VolumeX, BarChart3, LogOut, CheckCircle2, XCircle, Info, GraduationCap, Clock, 
  Building2, Briefcase, RefreshCw, ChevronLeft, ShieldCheck, HelpCircle, Laptop,
  User, CheckSquare, ListFilter, Users, History, CheckSquare as CheckSquareIcon,
  Activity, Mail, Phone, Settings, ChevronUp, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { Job, Candidate, MatchBreakdown } from '../types.js';
import TejomaLogo from './TejomaLogo.js';
import { apiFetch } from '../utils/apiFetch.js';

interface CardFieldProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}

const CardField: React.FC<CardFieldProps> = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-2.5 border-b border-[#E0E0E0] pb-2 text-left">
    <Icon className="w-3.5 h-3.5 text-[#27AE60] mt-0.5 mr-1.5 flex-shrink-0" />
    <div className="flex-1 min-w-0">
      <span className="block text-[11px] font-bold uppercase text-[#999999] tracking-wider leading-none mb-1">
        {label}
      </span>
      <div className="text-[13px] font-normal text-[#1A1A1A] leading-normal">
        {children}
      </div>
    </div>
  </div>
);

interface SwipeInterfaceProps {
  jobs: Job[];
  selectedJobId: number;
  setSelectedJobId: (id: number) => void;
  setActiveTab?: (tab: string) => void;
  onLogout?: () => void;
  userInfo?: { id: number; name: string; email: string; role: string } | null;
}

// Custom client-side synthesized sound generator using Web Audio API
const playSwipeSound = (type: 'accept' | 'reject' | 'save' | 'skip', enabled: boolean) => {
  if (!enabled) return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;
    
    if (type === 'accept') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.15);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'reject') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(130, now + 0.2);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'save') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.12);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'skip') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    }
  } catch (e) {
    console.warn('Audio synthesis failed:', e);
  }
};

export default function SwipeInterface({ 
  jobs, 
  selectedJobId, 
  setSelectedJobId,
  setActiveTab,
  onLogout,
  userInfo
}: SwipeInterfaceProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [matchScore, setMatchScore] = useState<number>(0);
  const [breakdown, setBreakdown] = useState<MatchBreakdown | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [remaining, setRemaining] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  // Refs for scrolling the main page viewport, the candidate card details, and full resume modal
  const viewportScrollRef = useRef<HTMLDivElement>(null);
  const cardScrollRef = useRef<HTMLDivElement>(null);
  const modalScrollRef = useRef<HTMLDivElement>(null);

  const scrollViewportUp = () => {
    if (viewportScrollRef.current) {
      viewportScrollRef.current.scrollBy({ top: -250, behavior: 'smooth' });
    }
  };

  const scrollViewportDown = () => {
    if (viewportScrollRef.current) {
      viewportScrollRef.current.scrollBy({ top: 250, behavior: 'smooth' });
    }
  };

  const scrollCardUp = () => {
    if (cardScrollRef.current) {
      cardScrollRef.current.scrollBy({ top: -160, behavior: 'smooth' });
    }
  };

  const scrollCardDown = () => {
    if (cardScrollRef.current) {
      cardScrollRef.current.scrollBy({ top: 160, behavior: 'smooth' });
    }
  };

  const scrollModalUp = () => {
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollBy({ top: -220, behavior: 'smooth' });
    }
  };

  const scrollModalDown = () => {
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollBy({ top: 220, behavior: 'smooth' });
    }
  };

  // Session stats & metrics
  const [reviewedCount, setReviewedCount] = useState(0);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Auto-hide Navigation trigger on mouse hover
  const [isTopNavVisible, setIsTopNavVisible] = useState(true);

  // Drag-to-swipe interactive states
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [activeSwipeDecision, setActiveSwipeDecision] = useState<'accept' | 'reject' | 'save' | null>(null);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | 'up' | null>(null);

  // Circular actions tooltips
  const [hoveredButton, setHoveredButton] = useState<'reject' | 'save' | 'accept' | null>(null);

  // Swipe Feed logs for Right Panel
  const [recentSwipes, setRecentSwipes] = useState<{ id: number; name: string; action: 'accept' | 'reject' | 'save'; score: number; timestamp: string }[]>([]);

  // Undo history stack
  const [historyStack, setHistoryStack] = useState<{ 
    swipe: any, 
    candidate: Candidate, 
    matchScore: number, 
    breakdown: MatchBreakdown, 
    summary: string 
  }[]>([]);

  // Advanced search/filter parameters
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterExp, setFilterExp] = useState<number>(0);
  const [filterLocation, setFilterLocation] = useState('');

  // Modals state
  const [showDetails, setShowDetails] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Window Resize Watcher for Viewport Breakpoints and Orientations
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowSize.width < 768;
  const isMobileLandscape = windowSize.height < 500 && windowSize.width > windowSize.height;
  const isTablet = windowSize.width >= 768 && windowSize.width < 1024;
  const isTabletLandscape = windowSize.width >= 1024 && windowSize.width < 1280;
  const isLaptopMedium = windowSize.width >= 1280 && windowSize.width < 1536;
  const isLaptopLarge = windowSize.width >= 1536 && windowSize.width < 1920;
  const isUltraWide = windowSize.width >= 1920;

  // Sync positions and load first queue
  useEffect(() => {
    const activeJobs = jobs.filter(j => j.status === 'open');
    if (activeJobs.length > 0 && !selectedJobId) {
      setSelectedJobId(activeJobs[0].id);
    }
  }, [jobs]);

  useEffect(() => {
    if (selectedJobId) {
      const currentJob = jobs.find(j => j.id === selectedJobId);
      if (currentJob) {
        setJob(currentJob);
        fetchNextQueue(selectedJobId);
        setHistoryStack([]);
        setRecentSwipes([]);
      }
    }
  }, [selectedJobId]);

  // Load starting swipe counters from DB on mount
  useEffect(() => {
    const loadCumulativeStats = async () => {
      try {
        const res = await apiFetch('/api/analytics/dashboard');
        if (res.ok) {
          const data = await res.json();
          setReviewedCount(data.totalCandidatesReviewed || 0);
          setAcceptedCount(data.matches_made || 0);
          setSavedCount(Math.max(0, Math.floor((data.totalCandidatesReviewed || 0) * 0.15)));
        }
      } catch (e) {
        console.error('Failed to pre-fetch cumulative swipe stats', e);
      }
    };
    loadCumulativeStats();
  }, []);

  // Time-tracking stopwatch loop
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isPaused) {
      timer = setInterval(() => {
        setTimeElapsed(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPaused]);

  // Top nav bar hover listener (shows top navigation if mouse moves near screen ceiling)
  useEffect(() => {
    setIsTopNavVisible(true);
  }, []);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showDetails) {
        if (e.key === 'Escape') {
          setShowDetails(false);
        }
        return;
      }
      
      if (e.key === 'ArrowLeft') {
        triggerSwipeAction('reject');
      } else if (e.key === 'ArrowRight') {
        triggerSwipeAction('accept');
      } else if (e.key === 'ArrowUp') {
        triggerSwipeAction('save');
      } else if (e.key === ' ') {
        e.preventDefault();
        fetchNextQueue(selectedJobId);
        playSwipeSound('skip', soundEnabled);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [candidate, selectedJobId, soundEnabled, showDetails]);

  const fetchNextQueue = async (jobId: number) => {
    if (!jobId || isNaN(jobId)) {
      setCandidate(null);
      setRemaining(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/matches/queue/${jobId}`);
      const data = await res.json();
      if (data.candidate) {
        setCandidate(data.candidate);
        setMatchScore(data.match_score);
        setBreakdown(data.breakdown);
        setSummary(data.summary);
        setRemaining(data.remaining);
      } else {
        setCandidate(null);
        setRemaining(0);
      }
    } catch (e) {
      console.error('Failed to load next match queue candidate:', e);
    } finally {
      setLoading(false);
    }
  };

  const submitSwipe = async (action: 0 | 1 | 0.5) => {
    if (!candidate || !job) return;

    // Save history snapshot for Undo support
    const currentSnapshot = {
      swipe: { recruiter_id: 1, job_id: job.id, candidate_id: candidate.id, action },
      candidate,
      matchScore,
      breakdown: breakdown!,
      summary
    };
    setHistoryStack(prev => [...prev, currentSnapshot]);

    // Push local feedback feed list
    const actionLabel = action === 1 ? 'accept' : action === 0 ? 'reject' : 'save';
    setRecentSwipes(prev => [
      {
        id: Date.now(),
        name: candidate.name,
        action: actionLabel,
        score: matchScore,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      },
      ...prev.slice(0, 5)
    ]);

    // Update metrics immediately for optimal UI reactivity
    setReviewedCount(prev => prev + 1);
    if (action === 1) setAcceptedCount(prev => prev + 1);
    if (action === 0.5) setSavedCount(prev => prev + 1);

    setLoading(true);
    try {
      const res = await apiFetch('/api/swipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recruiter_id: 1,
          job_id: job.id,
          candidate_id: candidate.id,
          action
        })
      });
      const data = await res.json();

      if (data.next_candidate) {
        setCandidate(data.next_candidate.candidate);
        setMatchScore(data.next_candidate.match_score);
        setBreakdown(data.next_candidate.breakdown);
        setSummary(data.next_candidate.summary);
        setRemaining(data.next_candidate.remaining);
      } else {
        setCandidate(null);
        setRemaining(0);
      }
    } catch (e) {
      console.error('Failed to post swipe selection:', e);
    } finally {
      setLoading(false);
      setDragOffset({ x: 0, y: 0 });
      setActiveSwipeDecision(null);
    }
  };

  // Programmatic swipe trigger supporting mouse clicks & shortcuts
  const triggerSwipeAction = async (decision: 'accept' | 'reject' | 'save') => {
    if (!candidate || loading || isPaused) return;

    playSwipeSound(decision, soundEnabled);
    setExitDirection(decision === 'accept' ? 'right' : decision === 'reject' ? 'left' : 'up');

    const numericChoice = decision === 'accept' ? 1 : decision === 'reject' ? 0 : 0.5;
    
    setTimeout(() => {
      submitSwipe(numericChoice);
      setExitDirection(null);
    }, 280);
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const previous = historyStack[historyStack.length - 1];
    
    setCandidate(previous.candidate);
    setMatchScore(previous.matchScore);
    setBreakdown(previous.breakdown);
    setSummary(previous.summary);
    setRemaining(prev => prev + 1);

    setReviewedCount(prev => Math.max(0, prev - 1));
    if (previous.swipe.action === 1) setAcceptedCount(prev => Math.max(0, prev - 1));
    if (previous.swipe.action === 0.5) setSavedCount(prev => Math.max(0, prev - 1));

    // Pull from local logs list too
    setRecentSwipes(prev => prev.slice(1));

    setHistoryStack(prev => prev.slice(0, -1));
    playSwipeSound('skip', soundEnabled);
  };

  const formatTime = (secs: number) => {
    const minutes = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const getScoreColorInfo = (score: number) => {
    if (score >= 85) return { color: 'text-[#27AE60]', border: 'border-[#27AE60]', bg: 'bg-[#E5F5E5]', text: 'Strong Match', hex: '#27AE60', bgHex: '#E5F5E5' };
    if (score >= 70) return { color: 'text-[#52C77D]', border: 'border-[#52C77D]', bg: 'bg-[#E5F5E5]', text: 'Good Match', hex: '#52C77D', bgHex: '#E5F5E5' };
    if (score >= 50) return { color: 'text-[#F39C12]', border: 'border-[#F39C12]', bg: 'bg-[#FFF9E5]', text: 'Fair Match', hex: '#F39C12', bgHex: '#FFF9E5' };
    return { color: 'text-[#E74C3C]', border: 'border-[#E74C3C]', bg: 'bg-[#FFE5E5]', text: 'Poor Match', hex: '#E74C3C', bgHex: '#FFE5E5' };
  };

  const isCandidateFilteredOut = () => {
    if (!candidate) return false;
    if (searchQuery && !candidate.name.toLowerCase().includes(searchQuery.toLowerCase())) return true;
    if (filterExp > 0 && candidate.years_of_experience < filterExp) return true;
    if (filterLocation && !candidate.current_location.toLowerCase().includes(filterLocation.toLowerCase())) return true;
    return false;
  };

  const formatSalary = (salary: number) => {
    if (!salary) return 'Not disclosed';
    if (salary <= 100) return `${salary}L`;
    if (salary >= 100000) {
      const lakhs = (salary / 100000).toFixed(1);
      return `${lakhs}L`;
    }
    if (salary >= 1000) {
      return `${(salary / 1000).toFixed(0)}k`;
    }
    return salary.toLocaleString();
  };

  const handleCopyText = (text: string, label: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const activeScoreInfo = getScoreColorInfo(matchScore);
  const swipeCountForRate = Math.max(1, reviewedCount);
  const acceptanceRate = Math.round((acceptedCount / swipeCountForRate) * 100);

  const getCandidateInitials = (name: string) => {
    if (!name) return 'C';
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  return (
    <div 
      id="tejoma-swipe-stage-container" 
      className="relative w-full h-full overflow-hidden flex flex-col select-none text-[#1A1A1A]"
      style={{ backgroundColor: '#F8F9FA' }}
    >
      
      {/* Dynamic typography, spacing, and sizing sheets using Clamp for robust scaling */}
      <style>{`
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient {
          background: #F8F9FA;
        }
        .stage-glow {
          position: absolute;
          width: 70vw;
          height: 70vh;
          background: radial-gradient(circle, rgba(39, 174, 96, 0.04) 0%, rgba(52, 152, 219, 0.03) 50%, transparent 100%);
          pointer-events: none;
          z-index: 0;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #F1F5F9;
          border-radius: 99px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #CBD5E1;
          border-radius: 99px;
          border: 1.5px solid #F1F5F9;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #27AE60;
        }
        
        /* 1. Dynamic Font Sizing using clamp() */
        .dynamic-name {
          font-size: clamp(20px, 3.5vw, 32px);
        }
        .dynamic-job-title {
          font-size: clamp(13px, 1.8vw, 17px);
        }
        .dynamic-match-score {
          font-size: clamp(30px, 5vw, 56px);
        }
        .dynamic-field-label {
          font-size: clamp(9px, 1.2vw, 11px);
        }
        .dynamic-field-value {
          font-size: clamp(11px, 1.5vw, 13px);
        }

        /* 2. Dynamic Spacing Sizing */
        .dynamic-card-padding {
          padding: clamp(12px, 2.5vw, 22px);
        }
        .dynamic-button-gap {
          gap: clamp(12px, 1.8vw, 20px);
        }
        .dynamic-section-margin {
          margin-top: clamp(8px, 1.8vw, 16px);
        }
        .dynamic-card-radius {
          border-radius: clamp(16px, 3.5vw, 24px);
        }

        /* 3. Responsive Card sizes */
        .recruitment-card {
          width: calc(100% - 24px);
          max-width: 360px;
          height: 540px;
          border-radius: 24px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.15);
          background: #FFFFFF;
          border: 1px solid #E0E0E0;
        }
        
        @media (min-width: 768px) {
          .recruitment-card {
            width: 380px;
            max-width: 380px;
            height: 600px;
            border-radius: 24px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
          }
        }
        
        @media (min-width: 1200px) {
          .recruitment-card {
            width: 420px;
            max-width: 420px;
            height: 680px;
            border-radius: 24px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
          }
        }

        /* 4. Landscape orientation overrides on small devices */
        @media (max-height: 500px) and (orientation: landscape) {
          .recruitment-card {
            width: 500px !important;
            max-width: 500px !important;
            height: 270px !important;
            border-radius: 24px !important;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15) !important;
          }
        }

        /* 5. Action Button Sizing */
        .action-button {
          width: 48px;
          height: 48px;
        }
        @media (min-width: 768px) {
          .action-button {
            width: 52px;
            height: 52px;
          }
        }
        @media (min-width: 1200px) {
          .action-button {
            width: 56px;
            height: 56px;
          }
        }
        @media (max-height: 500px) and (orientation: landscape) {
          .action-button {
            width: 36px !important;
            height: 36px !important;
          }
        }
      `}</style>

      {/* FIXED TOP NAVIGATION BAR */}
      <nav 
        id="tejoma-top-nav"
        className="w-full h-[60px] bg-white border-b border-[#E0E0E0] flex items-center justify-between px-4 md:px-6 z-20 shadow-[0_2px_8px_rgba(0,0,0,0.08)] flex-shrink-0"
      >
        {/* Left Section: Back Button + Logo with gap */}
        <div className="flex items-center gap-4">
          {setActiveTab && (
            <button 
              id="back-to-dashboard-btn"
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-1.5 text-[#27AE60] bg-[#E5F5E5] hover:bg-[#D4EFDF] py-2 px-4 rounded-lg transition-all cursor-pointer font-bold text-sm border border-[#A8E6C1]"
              title="Return to Dashboard"
            >
              <ChevronLeft className="w-4 h-4 text-[#27AE60]" />
              <span>Back</span>
            </button>
          )}
          <div className="flex items-center">
            <TejomaLogo size="sm" textColorClass="text-[#1A1A1A] font-extrabold" />
          </div>
        </div>

        {/* Center Section: Centered Job Info */}
        <div className="absolute left-1/2 transform -translate-x-1/2 font-bold text-sm text-[#1A1A1A] pointer-events-none hidden md:block">
          Position: {jobs.find(j => j.id === selectedJobId)?.title || "SDE1"}
        </div>

        {/* Right Section: Controls, audio state, settings, avatar */}
        <div className="flex items-center gap-4">
          {/* Fallback inline indicators for small screens */}
          <div className="md:hidden text-xs font-bold text-[#1A1A1A]">
            {jobs.find(j => j.id === selectedJobId)?.title || "SDE1"}
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Toggle button */}
            <button
              id="audio-toggle-btn"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1.5 rounded-lg text-[#666666] hover:text-[#27AE60] hover:bg-[#E5F5E5] transition-colors cursor-pointer"
              title={soundEnabled ? 'Mute sound effects' : 'Unmute sound effects'}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5 text-[#27AE60]" /> : <VolumeX className="w-5 h-5 text-[#E74C3C]" />}
            </button>

            {/* Filter Toggle */}
            <button
              id="filters-toggle-btn"
              onClick={() => setShowFilters(!showFilters)}
              className={`p-1.5 rounded-lg text-[#666666] hover:text-[#27AE60] hover:bg-[#E5F5E5] transition-all cursor-pointer ${
                showFilters ? 'bg-[#E5F5E5] text-[#27AE60] border border-[#A8E6C1]' : ''
              }`}
              title="Filter Candidates"
            >
              <Filter className="w-5 h-5" />
            </button>

            {/* Preferences Gear Trigger (Settings) */}
            <button
              id="preferences-nav-btn"
              onClick={() => setShowSettingsModal(true)}
              className="p-1.5 rounded-lg text-[#666666] hover:text-[#27AE60] hover:bg-[#E5F5E5] transition-colors cursor-pointer"
              title="System Settings"
            >
              <Settings className="w-5 h-5" style={{ width: '20px', height: '20px' }} />
            </button>

            {/* Analytics trigger */}
            {setActiveTab && (
              <button
                id="analytics-nav-btn"
                onClick={() => setActiveTab('analytics')}
                className="p-1.5 rounded-lg text-[#666666] hover:text-[#27AE60] hover:bg-[#E5F5E5] transition-colors cursor-pointer"
                title="Analytics Hub"
              >
                <BarChart3 className="w-5 h-5" />
              </button>
            )}

            {/* Logout Trigger */}
            {onLogout && (
              <button
                id="logout-nav-btn"
                onClick={onLogout}
                className="p-1.5 rounded-lg text-[#666666] hover:text-[#E74C3C] hover:bg-[#FFE5E5] transition-colors cursor-pointer"
                title="Terminate Session"
              >
                <LogOut className="w-5 h-5" />
              </button>
            )}
          </div>

          {userInfo && (
            <div className="flex items-center gap-2 border-l border-[#E0E0E0] pl-4">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#E8F4F8] to-[#F0E8F8] border border-[#E0E0E0] flex items-center justify-center font-extrabold text-[#27AE60] text-sm shadow-sm" style={{ width: '36px', height: '36px' }}>
                {userInfo.name[0]}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-[11px] font-bold text-[#1A1A1A] truncate leading-none">{userInfo.name}</p>
                <p className="text-[9px] text-[#666666] capitalize">{userInfo.role}</p>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* DYNAMIC SEARCH/FILTER & POSITION SELECTION BAR */}
      {showFilters && (
        <div id="filters-dropdown-bar" className="absolute top-[60px] left-0 right-0 bg-white/95 backdrop-blur-md border-b border-[#E0E0E0] p-4 z-40 flex flex-wrap gap-4 items-center justify-center text-xs shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="text-[#666666] font-semibold uppercase tracking-wider text-[10px]">Position Match:</span>
            <select
              value={isNaN(selectedJobId) || !selectedJobId ? "" : selectedJobId}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setSelectedJobId(isNaN(val) ? 0 : val);
              }}
              className="bg-[#F5F5F5] border border-[#E0E0E0] text-[#1A1A1A] rounded-lg py-1 px-2 focus:outline-none focus:border-[#27AE60] cursor-pointer font-bold"
            >
              {jobs.filter(j => j.status === 'open').map(j => (
                <option key={j.id} value={j.id} className="bg-white text-[#1A1A1A]">{j.title}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[#666666] font-semibold uppercase tracking-wider text-[10px]">Candidate Name:</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1.5 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name..."
                className="bg-[#F5F5F5] border border-[#E0E0E0] text-[#1A1A1A] rounded-lg py-1 pl-8 pr-3 w-40 focus:outline-none focus:border-[#27AE60]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[#666666] font-semibold uppercase tracking-wider text-[10px]">Min Experience:</span>
            <select
              value={filterExp}
              onChange={(e) => setFilterExp(parseInt(e.target.value))}
              className="bg-[#F5F5F5] border border-[#E0E0E0] text-[#1A1A1A] rounded-lg py-1 px-2 focus:outline-none focus:border-[#27AE60] cursor-pointer"
            >
              <option value="0" className="bg-white">Any Experience</option>
              <option value="2" className="bg-white">2+ Years</option>
              <option value="5" className="bg-white">5+ Years</option>
              <option value="8" className="bg-white">8+ Years</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[#666666] font-semibold uppercase tracking-wider text-[10px]">Location:</span>
            <input
              type="text"
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              placeholder="e.g. Bangalore"
              className="bg-[#F5F5F5] border border-[#E0E0E0] text-[#1A1A1A] rounded-lg py-1 px-3 w-32 focus:outline-none focus:border-[#27AE60]"
            />
          </div>

          <button 
            onClick={() => { setSearchQuery(''); setFilterExp(0); setFilterLocation(''); }}
            className="text-[#27AE60] hover:text-[#219653] font-bold underline text-[11px] cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      )}

      {/* COPIED TO CLIPBOARD ALERTER BADGE */}
      <AnimatePresence>
        {copiedText && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 bg-emerald-500 text-white font-extrabold text-xs px-5 py-2.5 rounded-full shadow-2xl z-50 flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{copiedText} copied to clipboard!</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN VIEWPORT LAYOUT WRAPPER (Adapts to side panels or single-column automatically) */}
      <div 
        ref={viewportScrollRef}
        id="tejoma-main-viewport-layout"
        className="flex-1 w-full overflow-y-auto custom-scrollbar flex flex-col items-center justify-start relative px-4 pt-6 md:pt-10 pb-24"
      >
        <div className="stage-glow"></div>



        {/* ================= CENTER CHASSIS: DYNAMIC TINDER INTERACTIVE ZONE ================= */}
        <div 
          id="recruiter-central-card-stage"
          className="flex-1 flex flex-col items-center justify-center z-10 px-4"
        >
          {loading ? (
            <div id="queue-loader-wrapper" className="flex flex-col items-center gap-3">
              <div className="relative flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-[#E5F5E5] border-t-[#27AE60] rounded-full animate-spin"></div>
                <Sparkles className="absolute w-5 h-5 text-[#27AE60] animate-pulse" />
              </div>
              <p className="text-xs text-slate-500 font-mono tracking-widest uppercase animate-pulse">Running talent matching algorithms...</p>
            </div>
          ) : isPaused ? (
            <div id="queue-paused-sheet" className="text-center space-y-4 max-w-sm bg-white border border-[#E0E0E0] shadow-2xl p-8 rounded-3xl">
              <div className="w-14 h-14 rounded-full bg-[#FFE5E5] border border-[#FFB3B3] flex items-center justify-center mx-auto text-[#E74C3C]">
                <Pause className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="text-base font-extrabold text-[#1A1A1A]">Matchmaking Paused</h3>
              <p className="text-xs text-[#666666] leading-relaxed">System is on standby. Use this moment to review matches. Click resume to initiate active matchmaking.</p>
              <button
                id="resume-swiping-btn"
                onClick={() => setIsPaused(false)}
                className="w-full bg-[#27AE60] hover:bg-[#219653] text-white font-bold text-xs py-3 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-lg active:scale-95"
              >
                Resume Matchmaking
              </button>
            </div>
          ) : !candidate ? (
            <div id="queue-complete-sheet" className="text-center space-y-4 max-w-sm bg-white border border-[#E0E0E0] shadow-2xl p-8 rounded-3xl">
              <div className="w-14 h-14 rounded-full bg-[#E5F5E5] border border-[#A8E6C1] flex items-center justify-center mx-auto text-[#27AE60]">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-base font-extrabold text-[#1A1A1A]">Scoring Queue Cleared!</h3>
              <p className="text-xs text-[#666666] leading-relaxed">All active talent profiles scored and matched for this opening. Adjust filters or register new positions to trigger new profiles.</p>
              {jobs.filter(j => j.status === 'open').length > 1 && (
                <div className="pt-2 text-xs text-[#1A1A1A] text-left space-y-1.5 border-t border-[#E0E0E0]">
                  <span className="text-[10px] text-[#666666] uppercase font-bold tracking-wider block">Score other positions:</span>
                  <select
                    id="queue-complete-job-select"
                    value={isNaN(selectedJobId) || !selectedJobId ? "" : selectedJobId}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setSelectedJobId(isNaN(val) ? 0 : val);
                    }}
                    className="w-full bg-[#F5F5F5] border border-[#E0E0E0] text-[#1A1A1A] rounded-lg py-2 px-3 focus:outline-none text-xs"
                  >
                    {jobs.filter(j => j.status === 'open').map(j => (
                      <option key={j.id} value={j.id} className="bg-white text-[#1A1A1A]">{j.title}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : isCandidateFilteredOut() ? (
            <div id="candidate-filtered-sheet" className="text-center space-y-3 bg-white border border-[#E0E0E0] shadow-2xl p-6 rounded-2xl max-w-sm">
              <Info className="w-8 h-8 text-[#F39C12] mx-auto" />
              <p className="text-xs text-slate-600">Active control parameters have excluded this scored candidate from view.</p>
              <button
                id="filtered-reset-criteria-btn"
                onClick={() => { setSearchQuery(''); setFilterExp(0); setFilterLocation(''); }}
                className="text-[#27AE60] hover:text-[#219653] text-xs font-semibold underline cursor-pointer"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            
            /* HIGH-POLISHED INTERACTIVE SWIPE COMPONENT WRAPPED IN FRAMER MOTION GESTURES */
            <div id="active-swipe-chassis" className={`flex ${isMobileLandscape ? 'flex-row items-center gap-4 max-w-2xl' : 'flex-col items-center justify-center max-w-xl'} w-full relative`}>
              
              {/* Mobile Portrait Position Selector (rendered only on mobile portrait above the card) */}
              {isMobile && !isMobileLandscape && (
                <div id="portrait-job-select-wrapper" className="w-full mb-3 px-1">
                  <div className="flex items-center justify-between bg-white border border-[#E0E0E0] rounded-xl px-3.5 py-1.5 text-xs shadow-sm">
                    <span className="text-[10px] uppercase font-bold text-[#666666] tracking-wider">Position Queue:</span>
                    <select
                      id="portrait-job-select"
                      value={isNaN(selectedJobId) || !selectedJobId ? "" : selectedJobId}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setSelectedJobId(isNaN(val) ? 0 : val);
                      }}
                      className="bg-transparent text-[#1A1A1A] text-xs font-bold focus:outline-none cursor-pointer max-w-[180px] truncate"
                    >
                      {jobs.filter(j => j.status === 'open').map(j => (
                        <option key={j.id} value={j.id} className="bg-white text-[#1A1A1A]">{j.title}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              
              {/* Landscape Left Sidebar (For Mobile Landscape orientation) */}
              {isMobileLandscape && (
                <div id="landscape-left-nav" className="flex flex-col gap-1.5 w-[110px] bg-white p-2.5 border border-[#E0E0E0] rounded-2xl text-left shadow-sm">
                  <span className="text-[9px] uppercase font-bold text-[#666666] tracking-wider">Position:</span>
                  <select
                    id="landscape-job-select"
                    value={isNaN(selectedJobId) || !selectedJobId ? "" : selectedJobId}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setSelectedJobId(isNaN(val) ? 0 : val);
                    }}
                    className="bg-[#F5F5F5] border border-[#E0E0E0] text-[#1A1A1A] text-[9px] p-0.5 rounded focus:outline-none w-full cursor-pointer font-bold truncate"
                  >
                    {jobs.filter(j => j.status === 'open').map(j => (
                      <option key={j.id} value={j.id} className="bg-white text-[#1A1A1A]">{j.title}</option>
                    ))}
                  </select>
                  <div className="border-t border-[#E0E0E0] my-0.5"></div>
                  <span className="text-[9px] uppercase font-bold text-[#666666] tracking-wider">Score:</span>
                  <div className={`p-1 text-center font-black rounded text-[10px] ${activeScoreInfo.bg} ${activeScoreInfo.color} border ${activeScoreInfo.border}`}>
                    {matchScore}%
                  </div>
                </div>
              )}

              <AnimatePresence mode="popLayout">
                <motion.div
                  id={`candidate-card-${candidate.id}`}
                  key={candidate.id}
                  drag={!isMobileLandscape} // Disable drag on mobile landscape to prevent layout clipping
                  dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                  dragElastic={0.7}
                  onDrag={(event, info) => {
                    setDragOffset({ x: info.offset.x, y: info.offset.y });
                    if (info.offset.x > 120) {
                      setActiveSwipeDecision('accept');
                    } else if (info.offset.x < -120) {
                      setActiveSwipeDecision('reject');
                    } else if (info.offset.y < -120) {
                      setActiveSwipeDecision('save');
                    } else {
                      setActiveSwipeDecision(null);
                    }
                  }}
                  onDragEnd={(event, info) => {
                    if (info.offset.x > 150) {
                      triggerSwipeAction('accept');
                    } else if (info.offset.x < -150) {
                      triggerSwipeAction('reject');
                    } else if (info.offset.y < -150) {
                      triggerSwipeAction('save');
                    } else {
                      setDragOffset({ x: 0, y: 0 });
                      setActiveSwipeDecision(null);
                    }
                  }}
                  initial={{ scale: 0.95, opacity: 0, y: 15 }}
                  animate={{ 
                    scale: 1, 
                    opacity: 1, 
                    y: exitDirection === 'up' ? -500 : 0,
                    x: exitDirection === 'left' ? -500 : exitDirection === 'right' ? 500 : 0,
                    rotate: exitDirection === 'left' ? -20 : exitDirection === 'right' ? 20 : 0
                  }}
                  exit={{
                    x: exitDirection === 'left' ? -600 : exitDirection === 'right' ? 600 : 0,
                    y: exitDirection === 'up' ? -600 : 0,
                    opacity: 0,
                    rotate: exitDirection === 'left' ? -25 : exitDirection === 'right' ? 25 : 0,
                    scale: exitDirection === 'up' ? 0.8 : 0.95,
                    transition: { duration: 0.28, ease: 'easeOut' }
                  }}
                  style={{
                    x: exitDirection ? undefined : dragOffset.x,
                    y: exitDirection ? undefined : dragOffset.y,
                    rotate: exitDirection ? undefined : dragOffset.x * 0.04,
                    scale: exitDirection ? undefined : (dragOffset.y < 0 ? 1 + Math.abs(dragOffset.y) * 0.00015 : 1),
                  }}
                  className={`recruitment-card bg-white text-slate-800 flex ${isMobileLandscape ? 'flex-row' : 'flex-col'} justify-between overflow-hidden relative select-none border border-slate-200 shadow-md rounded-[24px]`}
                >
                  
                  {/* REALTIME ACTION CORNER LABELS */}
                  {activeSwipeDecision === 'accept' && (
                    <div className="absolute inset-0 bg-emerald-500/15 backdrop-blur-xs z-30 flex items-center justify-center pointer-events-none border-4 border-[#27AE60] rounded-[24px]">
                      <div className="bg-white px-5 py-2 rounded-2xl border-2 border-[#27AE60] flex flex-col items-center shadow-2xl transform rotate-12 scale-110">
                        <CheckCircle2 className="w-8 h-8 text-[#27AE60]" />
                        <span className="text-xs font-black uppercase tracking-wider text-[#27AE60] mt-1">Accept</span>
                      </div>
                    </div>
                  )}
                  {activeSwipeDecision === 'reject' && (
                    <div className="absolute inset-0 bg-rose-500/15 backdrop-blur-xs z-30 flex items-center justify-center pointer-events-none border-4 border-[#E74C3C] rounded-[24px]">
                      <div className="bg-white px-5 py-2 rounded-2xl border-2 border-[#E74C3C] flex flex-col items-center shadow-2xl transform -rotate-12 scale-110">
                        <XCircle className="w-8 h-8 text-[#E74C3C]" />
                        <span className="text-xs font-black uppercase tracking-wider text-[#E74C3C] mt-1">Reject</span>
                      </div>
                    </div>
                  )}
                  {activeSwipeDecision === 'save' && (
                    <div className="absolute inset-0 bg-amber-500/15 backdrop-blur-xs z-30 flex items-center justify-center pointer-events-none border-4 border-[#F39C12] rounded-[24px]">
                      <div className="bg-white px-5 py-2 rounded-2xl border-2 border-[#F39C12] flex flex-col items-center shadow-2xl transform scale-110">
                        <Star className="w-8 h-8 text-[#F39C12] fill-[#F39C12]" />
                        <span className="text-xs font-black uppercase tracking-wider text-[#F39C12] mt-1">Save</span>
                      </div>
                    </div>
                  )}

                  {/* SECTION 2: mobile-landscape only - the shaded hero image area was removed for
                      the normal portrait/desktop layout, but this left-column layout still needs
                      to exist here since it's also where the swipe action buttons live in that mode. */}
                  {isMobileLandscape && (
                    <div className="relative w-[115px] h-full flex-col justify-center bg-gradient-to-br from-[#E8F4F8] to-[#F0E8F8] flex items-center justify-center overflow-hidden flex-shrink-0">
                      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#1A1A1A_2px,transparent_2px)] [background-size:16px_16px]"></div>

                      <span className="text-[#27AE60] font-extrabold text-2xl mb-4 tracking-wider select-none drop-shadow-sm">
                        {getCandidateInitials(candidate.name)}
                      </span>

                      <div className="flex flex-col gap-1.5 items-center w-full px-2 mb-10 text-center">
                        <span className="text-[9px] text-[#27AE60] font-bold bg-[#E5F5E5] border border-[#A8E6C1] px-2 py-0.5 rounded w-full truncate">{candidate.years_of_experience} yrs exp</span>
                        <span className="text-[9px] text-[#3498DB] font-bold bg-[#E8F4F8] border border-[#AED6F1] px-2 py-0.5 rounded w-full truncate">{candidate.current_location}</span>
                      </div>

                      <div className="absolute bottom-3 left-0 right-0 flex items-center justify-around px-1 z-10">
                        <button
                          onClick={() => triggerSwipeAction('reject')}
                          className="w-8 h-8 rounded-full bg-[#FFE5E5] border border-[#FFB3B3] text-[#E74C3C] flex items-center justify-center transition-all duration-200 active:scale-125 cursor-pointer shadow-sm"
                          title="Reject Candidate"
                        >
                          <X className="w-3.5 h-3.5 stroke-[3]" />
                        </button>
                        <button
                          onClick={() => triggerSwipeAction('save')}
                          className="w-8 h-8 rounded-full bg-[#FFF9E5] border border-[#FFE680] text-[#F39C12] flex items-center justify-center transition-all duration-200 active:scale-125 cursor-pointer shadow-sm"
                          title="Save for Later"
                        >
                          <Star className="w-3.5 h-3.5 fill-none stroke-[2.5]" />
                        </button>
                        <button
                          onClick={() => triggerSwipeAction('accept')}
                          className="w-8 h-8 rounded-full bg-[#E5F5E5] border border-[#A8E6C1] text-[#27AE60] flex items-center justify-center transition-all duration-200 active:scale-125 cursor-pointer shadow-sm"
                          title="Accept Candidate"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* SECTION 3 & 4: DETAILS AND FIELDS AREA - now takes the full card height in the
                      normal layout since the shaded image section above it was removed. */}
                  <div className={`flex-1 ${isMobileLandscape ? 'h-full px-4 pt-3 pb-2' : 'px-5 pt-5 pb-3'} bg-white flex flex-col justify-between overflow-hidden relative text-left`}>

                    {/* Header Row: Name + Job title left, Prominent Match Score circle right */}
                    <div className="flex justify-between items-start gap-4">
                      <div className="text-left flex-1 min-w-0">
                        <h2 className="text-[28px] font-bold text-[#1A1A1A] tracking-tight leading-tight truncate" title={candidate.name}>
                          {candidate.name}
                        </h2>
                        <p className="text-base text-[#666666] font-semibold truncate leading-snug mt-1" title={candidate.current_job_title}>
                          {candidate.current_job_title}
                        </p>
                        {!isMobileLandscape && (
                          <div className="flex items-center gap-2 mt-2">
                            <span className="flex items-center gap-1 text-[10px] font-bold text-[#27AE60] bg-[#E5F5E5] border border-[#A8E6C1] px-2 py-1 rounded-full">
                              <Clock className="w-3 h-3" /> {candidate.years_of_experience} yrs
                            </span>
                            <span className="flex items-center gap-1 text-[10px] font-bold text-[#3498DB] bg-[#E8F4F8] border border-[#AED6F1] px-2 py-1 rounded-full truncate max-w-[140px]">
                              <MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{candidate.current_location}</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Prominent Match circular score */}
                      {!isMobileLandscape && (
                        <div className="flex flex-col items-center flex-shrink-0">
                          <div className={`w-14 h-14 rounded-full border-2 flex items-center justify-center relative ${activeScoreInfo.bg} ${activeScoreInfo.border} ${activeScoreInfo.color}`}>
                            <span className="text-xl font-bold">{matchScore}%</span>
                          </div>
                          <span className="text-xs font-black uppercase mt-1 text-center whitespace-nowrap" style={{ color: activeScoreInfo.hex }}>
                            {activeScoreInfo.text}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Score Breakdown (below header) */}
                    {!isMobileLandscape && (
                      <div className="text-[11px] text-[#999999] font-medium tracking-wide mt-2 border-t border-[#F5F5F5] pt-2 mb-1">
                        Skills {breakdown?.skills?.score ?? 40}% • Exp {breakdown?.experience?.score ?? 35}% • Location {breakdown?.location?.score ?? 15}% • Salary {breakdown?.salary?.score ?? 10}%
                      </div>
                    )}

                    {/* ALL 15 CANDIDATE FIELDS - SCROLLABLE */}
                    <div ref={cardScrollRef} className="flex-1 overflow-y-auto custom-scrollbar pr-1 pb-2 text-left mt-2 relative">
                      
                      {/* Divider line above fields */}
                      <div className="h-[1px] bg-[#E0E0E0] my-3"></div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
                        
                        {/* 1. EMAIL */}
                        <CardField icon={Mail} label="Email">
                          <div className="font-mono flex items-center justify-between mt-0.5">
                            <span className="truncate pr-1 font-bold">{candidate.email}</span>
                            <button
                              onClick={(e) => handleCopyText(candidate.email, 'Email address', e)}
                              className="p-0.5 text-slate-400 hover:text-[#27AE60] rounded transition-colors flex-shrink-0 cursor-pointer"
                              title="Copy Email"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </CardField>

                        {/* 2. PHONE */}
                        <CardField icon={Phone} label="Phone">
                          <div className="font-mono flex items-center justify-between mt-0.5">
                            <span className="truncate pr-1 font-bold">{candidate.phone}</span>
                            <button
                              onClick={(e) => handleCopyText(candidate.phone, 'Phone number', e)}
                              className="p-0.5 text-slate-400 hover:text-[#27AE60] rounded transition-colors flex-shrink-0 cursor-pointer"
                              title="Copy Phone"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </CardField>

                        {/* 3. SKILLS */}
                        <div className="md:col-span-2">
                          <CardField icon={CheckSquare} label="Skills">
                            <div className="flex flex-wrap gap-1 mt-1">
                              {candidate.skills.map((skill, i) => (
                                <span key={i} className="text-[10px] bg-[#E5F5E5] text-[#27AE60] font-bold px-2 py-0.5 rounded border border-[#A8E6C1]">
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </CardField>
                        </div>

                        {/* 4. EXPERIENCE */}
                        <CardField icon={Clock} label="Years of Experience">
                          <span className="font-bold text-[#1A1A1A]">{candidate.years_of_experience} years</span>
                        </CardField>

                        {/* 5. LOCATION */}
                        <CardField icon={MapPin} label="Current Location">
                          <span className="font-bold text-[#1A1A1A]">{candidate.current_location}</span>
                        </CardField>

                        {/* 6. CURRENT COMPANY */}
                        <CardField icon={Building2} label="Current Company">
                          <span className="font-bold text-[#1A1A1A]">{candidate.current_company || 'Independent'}</span>
                        </CardField>

                        {/* 7. PREVIOUS COMPANIES */}
                        <div className="md:col-span-2">
                          <CardField icon={History} label="Previous Companies">
                            <span className="text-slate-600 block leading-relaxed text-xs">
                              {candidate.previous_companies && candidate.previous_companies.length > 0 
                                ? candidate.previous_companies.join(', ') 
                                : 'None listed'}
                            </span>
                          </CardField>
                        </div>

                        {/* 8. CURRENT JOB TITLE */}
                        <CardField icon={Briefcase} label="Current Job Title">
                          <span className="font-bold text-[#1A1A1A]">{candidate.current_job_title}</span>
                        </CardField>

                        {/* 9. SALARY EXPECTATION */}
                        <CardField icon={DollarSign} label="Salary Expectation">
                          <span className="font-bold text-[#27AE60]">
                            {candidate.expected_ctc || 'Not disclosed'}
                          </span>
                        </CardField>

                        {/* 10. EDUCATION */}
                        <CardField icon={GraduationCap} label="Education">
                          <span className="font-bold text-[#1A1A1A]">{candidate.education || 'Not disclosed'}</span>
                        </CardField>

                        {/* 11. LOCATION (Preferred/Current duplication) */}
                        <CardField icon={MapPin} label="Location Preferences">
                          <span className="font-bold text-[#1A1A1A]">{candidate.current_location}</span>
                        </CardField>

                        {/* 12. NOTICE PERIOD */}
                        <CardField icon={Calendar} label="Notice Period">
                          <span className="font-bold text-[#1A1A1A]">{candidate.notice_period || 'Immediate'}</span>
                        </CardField>

                        {/* 13. WILLING TO RELOCATE */}
                        <CardField icon={MapPin} label="Willingness to Relocate">
                          {candidate.willingness_to_relocate ? (
                            <span className="text-[10px] text-[#27AE60] bg-[#E5F5E5] px-2 py-0.5 rounded border border-[#A8E6C1] font-bold">
                              Yes
                            </span>
                          ) : (
                            <span className="text-[10px] text-[#E74C3C] bg-[#FFE5E5] px-2 py-0.5 rounded border border-[#FFB3B3] font-bold">
                              No
                            </span>
                          )}
                        </CardField>

                        {/* 14. INDUSTRY DOMAIN */}
                        <CardField icon={Briefcase} label="Industry Domain">
                          <span className="font-bold text-[#1A1A1A]">{candidate.industry_domain || 'Software Development'}</span>
                        </CardField>

                        {/* 15. CERTIFICATIONS */}
                        <div className="md:col-span-2">
                          <CardField icon={Award} label="Certifications">
                            <span className="block text-xs font-bold text-[#1A1A1A]">
                              {candidate.certifications && candidate.certifications.length > 0 
                                ? candidate.certifications.join(', ') 
                                : 'None'}
                            </span>
                          </CardField>
                        </div>

                      </div>

                      {/* Resume Transcript Modal trigger */}
                      <button
                        id="trigger-full-resume-inspect"
                        onClick={() => setShowDetails(true)}
                        className="w-full text-center py-2.5 bg-[#F5F5F5] hover:bg-[#E0E0E0] border border-[#E0E0E0] text-[#1A1A1A] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer mt-3 shadow-sm"
                      >
                        <BookOpen className="w-4 h-4 text-[#27AE60]" /> Inspect Full Resume
                      </button>

                    </div>

                    {/* Floating Scroll up/down controls for easy navigation */}
                    <div className="absolute right-3.5 bottom-16 flex flex-col gap-1.5 z-35">
                      <button
                        onClick={scrollCardUp}
                        className="w-7 h-7 rounded-full bg-white/95 hover:bg-[#27AE60] text-[#27AE60] hover:text-white border border-slate-200 hover:border-[#27AE60] shadow-md flex items-center justify-center transition-all cursor-pointer active:scale-90"
                        title="Scroll Details Up"
                      >
                        <ChevronUp className="w-4 h-4 stroke-[3]" />
                      </button>
                      <button
                        onClick={scrollCardDown}
                        className="w-7 h-7 rounded-full bg-white/95 hover:bg-[#27AE60] text-[#27AE60] hover:text-white border border-slate-200 hover:border-[#27AE60] shadow-md flex items-center justify-center transition-all cursor-pointer active:scale-90"
                        title="Scroll Details Down"
                      >
                        <ChevronDown className="w-4 h-4 stroke-[3]" />
                      </button>
                    </div>

                  </div>

                  {/* SECTION 5: ACTION FOOTER BAR (10% of card, 70px height) */}
                  {!isMobileLandscape && (
                    <div className="bg-[#F5F5F5] border-t border-[#E0E0E0] flex items-center justify-center gap-5 relative px-4 h-[70px] py-4 rounded-b-[24px] shadow-sm z-20 flex-shrink-0">
                      
                      {/* Button 1: Unlike (Reject) */}
                      <div className="flex flex-col items-center relative">
                        <button
                          id="action-reject-btn"
                          onClick={() => triggerSwipeAction('reject')}
                          onMouseEnter={() => setHoveredButton('reject')}
                          onMouseLeave={() => setHoveredButton(null)}
                          className="w-14 h-14 rounded-full bg-[#FFE5E5] border-2 border-[#FFB3B3] text-[#E74C3C] flex items-center justify-center transition-all duration-300 active:scale-125 transform hover:scale-110 hover:bg-[#FFCCCC] shadow-md cursor-pointer"
                          title="Unlike Candidate"
                        >
                          <X className="w-6 h-6 stroke-[3]" />
                        </button>
                        <AnimatePresence>
                          {hoveredButton === 'reject' && (
                            <motion.span 
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 5 }}
                              className="absolute -bottom-5 text-[10px] font-bold text-[#E74C3C] whitespace-nowrap"
                            >
                              Unlike
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Button 2: Save */}
                      <div className="flex flex-col items-center relative">
                        <button
                          id="action-save-btn"
                          onClick={() => triggerSwipeAction('save')}
                          onMouseEnter={() => setHoveredButton('save')}
                          onMouseLeave={() => setHoveredButton(null)}
                          className="w-14 h-14 rounded-full bg-[#FFF9E5] border-2 border-[#FFE680] text-[#F39C12] flex items-center justify-center transition-all duration-300 active:scale-125 transform hover:scale-110 hover:bg-[#FFECCC] shadow-md cursor-pointer"
                          title="Save Candidate"
                        >
                          <Star className="w-6 h-6 fill-none stroke-[2.5]" />
                        </button>
                        <AnimatePresence>
                          {hoveredButton === 'save' && (
                            <motion.span 
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 5 }}
                              className="absolute -bottom-5 text-[10px] font-bold text-[#F39C12] whitespace-nowrap"
                            >
                              Save
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Button 3: Like (Accept) */}
                      <div className="flex flex-col items-center relative">
                        <button
                          id="action-accept-btn"
                          onClick={() => triggerSwipeAction('accept')}
                          onMouseEnter={() => setHoveredButton('accept')}
                          onMouseLeave={() => setHoveredButton(null)}
                          className="w-14 h-14 rounded-full bg-[#E5F5E5] border-2 border-[#A8E6C1] text-[#27AE60] flex items-center justify-center transition-all duration-300 active:scale-125 transform hover:scale-110 hover:bg-[#CCFFCC] shadow-md cursor-pointer"
                          title="Like Candidate"
                        >
                          <Check className="w-6 h-6 stroke-[3]" />
                        </button>
                        <AnimatePresence>
                          {hoveredButton === 'accept' && (
                            <motion.span 
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 5 }}
                              className="absolute -bottom-5 text-[10px] font-bold text-[#27AE60] whitespace-nowrap"
                            >
                              Like
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>

                    </div>
                  )}

                </motion.div>
              </AnimatePresence>

              {/* Landscape Right Panel (For Mobile Landscape orientation) */}
              {isMobileLandscape && (
                <div id="landscape-right-stats" className="flex flex-col gap-1.5 w-[110px] bg-white p-2.5 border border-[#E0E0E0] rounded-2xl text-left text-[10px] shadow-sm text-[#1A1A1A]">
                  <span className="text-[9px] uppercase font-bold text-[#666666] tracking-wider">Telemetry:</span>
                  <div className="space-y-0.5">
                    <div>Swipes: <strong className="text-[#27AE60]">{reviewedCount}</strong></div>
                    <div>Matches: <strong className="text-[#27AE60]">{acceptedCount}</strong></div>
                    <div>Saved: <strong className="text-[#F39C12]">{savedCount}</strong></div>
                  </div>
                  <div className="border-t border-[#E0E0E0] my-0.5"></div>
                  <button
                    id="landscape-undo-btn"
                    onClick={handleUndo}
                    disabled={historyStack.length === 0}
                    className="w-full text-center py-1 bg-white border border-[#E0E0E0] hover:bg-[#F5F5F5] disabled:opacity-40 text-[#1A1A1A] rounded font-bold transition-all text-[9px] cursor-pointer shadow-xs"
                  >
                    Undo Swipe
                  </button>
                </div>
              )}

            </div>
          )}

          {/* ================= STAGE BOTTOM ACTIONS: UNDO, REWIND, TIMERS ================= */}
          {!isMobileLandscape && (
            <div 
              id="central-swipe-actions-bar"
              className="w-full max-w-xs md:max-w-sm flex justify-between items-center mt-6 z-20"
            >
              {/* Undo Swipe Trigger */}
              <button
                id="footer-undo-btn"
                onClick={handleUndo}
                disabled={historyStack.length === 0}
                className="w-10 h-10 rounded-xl bg-white border border-[#E0E0E0] hover:bg-[#F5F5F5] disabled:opacity-30 text-[#1A1A1A] flex items-center justify-center transition-all shadow-md cursor-pointer"
                title="Undo last swipe action"
              >
                <RotateCcw className="w-4 h-4 text-[#27AE60]" />
              </button>

              {/* Session Stopwatch timer overlay */}
              <span id="session-stopwatch-display" className="text-[10px] lg:text-[11px] font-mono font-bold text-[#1A1A1A] bg-white border border-[#E0E0E0] px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-[#27AE60] animate-pulse"></span>
                <span>Session: {formatTime(timeElapsed)}</span>
              </span>

              {/* Skip current profile */}
              <button
                id="footer-skip-btn"
                onClick={() => {
                  fetchNextQueue(selectedJobId);
                  playSwipeSound('skip', soundEnabled);
                }}
                disabled={!candidate}
                className="w-10 h-10 rounded-xl bg-white border border-[#E0E0E0] hover:bg-[#F5F5F5] disabled:opacity-30 text-[#1A1A1A] flex items-center justify-center transition-all shadow-md cursor-pointer"
                title="Skip this profile"
              >
                <FastForward className="w-4 h-4 text-[#27AE60]" />
              </button>
            </div>
          )}

          {/* Keyboard Shortcuts Cheat Sheet Label (Shown on Tablet & Desktop) */}
          {!isMobile && !isMobileLandscape && (
            <p id="keyboard-short-hint" className="text-[10px] text-slate-500 font-medium tracking-wide mt-4">
              ⌨ Shortcuts: <kbd className="bg-white border border-[#E0E0E0] px-1.5 py-0.5 rounded text-[#1A1A1A] shadow-xs">←</kbd> Reject · <kbd className="bg-white border border-[#E0E0E0] px-1.5 py-0.5 rounded text-[#1A1A1A] shadow-xs">→</kbd> Accept · <kbd className="bg-white border border-[#E0E0E0] px-1.5 py-0.5 rounded text-[#1A1A1A] shadow-xs">↑</kbd> Save · <kbd className="bg-white border border-[#E0E0E0] px-2 py-0.5 rounded text-[#1A1A1A] shadow-xs">Space</kbd> Skip
            </p>
          )}
        </div>


      </div>

      {/* FLOATING PAGE SCROLL CONTROLS (Easily scroll the Match Candidates page up and down) */}
      <div 
        id="viewport-page-scroll-controls"
        className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 md:gap-2 z-40 bg-white/95 backdrop-blur-md border border-slate-200/80 p-2 rounded-2xl shadow-xl transition-all"
      >
        <div className="text-[9px] uppercase font-black text-[#27AE60] text-center px-1 mb-1 tracking-wider select-none">
          Page
        </div>
        <button
          onClick={scrollViewportUp}
          className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-white hover:bg-[#27AE60] text-[#27AE60] hover:text-white border border-slate-200 hover:border-[#27AE60] shadow-sm flex items-center justify-center transition-all cursor-pointer active:scale-90 group"
          title="Scroll Page Up"
        >
          <ChevronUp className="w-4 h-4 md:w-5 md:h-5 stroke-[3] group-hover:-translate-y-0.5 transition-transform" />
        </button>
        <button
          onClick={scrollViewportDown}
          className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-white hover:bg-[#27AE60] text-[#27AE60] hover:text-white border border-slate-200 hover:border-[#27AE60] shadow-sm flex items-center justify-center transition-all cursor-pointer active:scale-90 group"
          title="Scroll Page Down"
        >
          <ChevronDown className="w-4 h-4 md:w-5 md:h-5 stroke-[3] group-hover:translate-y-0.5 transition-transform" />
        </button>
      </div>

      {/* COMPACT BOTTOM FIXED TELEMETRY BAR (ONLY VISIBLE ON MOBILE PORTRAIT / TABLET PORTRAIT) */}
      {(isMobile || isTablet) && !isMobileLandscape && (
        <div 
          id="compact-bottom-telemetry"
          className="w-full bg-white border-t border-[#E0E0E0] p-3 text-[11px] font-semibold text-[#1A1A1A] flex items-center justify-around z-30 shadow-md"
        >
          <div>Reviewed: <span className="text-[#27AE60] font-bold">{reviewedCount}</span></div>
          <div>Matches: <span className="text-[#27AE60] font-bold">{acceptedCount}</span></div>
          <div>Saved: <span className="text-[#F39C12] font-bold">{savedCount}</span></div>
          <div>Rate: <span className="text-[#27AE60] font-bold">{acceptanceRate}%</span></div>
        </div>
      )}

      {/* FULL CANDIDATE PROFILE DETAILS BACKSTAGE SCREEN POPUP */}
      <AnimatePresence>
        {showDetails && candidate && (
          <motion.div 
            id="candidate-details-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 text-xs"
          >
            <motion.div 
              id="candidate-details-modal-box"
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="relative bg-white border border-[#E0E0E0] rounded-3xl w-full max-w-2xl h-[85vh] flex flex-col justify-between shadow-2xl overflow-hidden text-left"
            >
              {/* Header block */}
              <div className="p-6 border-b border-[#E0E0E0] flex justify-between items-start bg-[#F9FBF9]">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#E8F4F8] to-[#F0E8F8] flex items-center justify-center font-bold text-[#27AE60] text-base shadow-sm border border-[#E0E0E0]">
                    {getCandidateInitials(candidate.name)}
                  </div>
                  <div className="text-left">
                    <h3 className="text-lg font-extrabold text-[#1A1A1A] leading-tight">{candidate.name}</h3>
                    <p className="text-xs text-[#666666] mt-1 font-semibold">
                      {candidate.current_job_title} · <span className="text-[#27AE60]">{candidate.current_company || 'Independent'}</span>
                    </p>
                  </div>
                </div>
                <button
                  id="close-details-top-btn"
                  onClick={() => setShowDetails(false)}
                  className="text-slate-400 hover:text-[#1A1A1A] border border-[#E0E0E0] p-1.5 rounded-lg transition-colors cursor-pointer bg-white shadow-xs"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Information Body */}
              <div ref={modalScrollRef} className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar text-[#1A1A1A] leading-relaxed text-xs">
                
                {/* Contact grid */}
                <div className="grid grid-cols-2 gap-4 bg-[#F5F5F5] p-4 border border-[#E0E0E0] rounded-2xl">
                  <div>
                    <span className="text-[9px] text-[#666666] uppercase font-black tracking-wider">Email Address</span>
                    <p className="text-[#1A1A1A] font-mono mt-0.5">{candidate.email}</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#666666] uppercase font-black tracking-wider">Mobile Number</span>
                    <p className="text-[#1A1A1A] font-mono mt-0.5">{candidate.phone}</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#666666] uppercase font-black tracking-wider">Target Notice Period</span>
                    <p className="font-semibold mt-0.5 text-[#27AE60]">{candidate.notice_period || 'Immediate'}</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#666666] uppercase font-black tracking-wider">Relocation Willingness</span>
                    <p className="text-[#1A1A1A] font-bold mt-0.5">
                      {candidate.willingness_to_relocate ? (
                        <span className="text-[#27AE60] bg-[#E5F5E5] px-2 py-0.5 rounded border border-[#A8E6C1] font-bold">Yes</span>
                      ) : (
                        <span className="text-[#E74C3C] bg-[#FFE5E5] px-2 py-0.5 rounded border border-[#FFB3B3] font-bold">No</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Academic Background */}
                <div className="space-y-2">
                  <h4 className="font-extrabold text-[#1A1A1A] uppercase tracking-wide flex items-center gap-2 text-[10px]">
                    <GraduationCap className="w-4 h-4 text-[#27AE60]" /> Education & Academic Background
                  </h4>
                  <div className="bg-[#F5F5F5] border border-[#E0E0E0] p-4 rounded-xl">
                    <p className="text-[#1A1A1A] font-medium">{candidate.education || 'Not disclosed'}</p>
                  </div>
                </div>

                {/* Skills & Certifications */}
                <div className="space-y-2">
                  <h4 className="font-extrabold text-[#1A1A1A] uppercase tracking-wide flex items-center gap-2 text-[10px]">
                    <Award className="w-4 h-4 text-[#27AE60]" /> Skills & Core Certifications
                  </h4>
                  <div className="flex flex-wrap gap-2 bg-[#F5F5F5]/40 p-4 border border-[#E0E0E0] rounded-xl">
                    {candidate.skills.map((s, idx) => (
                      <span key={idx} className="bg-[#E5F5E5] text-[#27AE60] border border-[#A8E6C1] px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                        {s}
                      </span>
                    ))}
                    {candidate.certifications && candidate.certifications.map((c, idx) => (
                      <span key={idx} className="bg-white text-[#1A1A1A] border border-[#E0E0E0] px-2.5 py-1 rounded-lg text-[10px] font-semibold">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Raw Resume text transcript */}
                <div className="space-y-2">
                  <span className="text-[9px] text-[#666666] uppercase font-black tracking-wider block">Raw Resume File Transcript</span>
                  <div className="bg-[#F5F5F5] border border-[#E0E0E0] p-4 rounded-xl font-mono text-[11px] text-[#1A1A1A] max-h-48 overflow-y-auto whitespace-pre-wrap leading-normal custom-scrollbar">
                    {candidate.resume_text}
                  </div>
                </div>
              </div>

              {/* Floating Scroll up/down controls for modal */}
              <div className="absolute right-5 bottom-24 flex flex-col gap-1.5 z-40">
                <button
                  onClick={scrollModalUp}
                  className="w-8 h-8 rounded-full bg-white hover:bg-[#27AE60] text-[#27AE60] hover:text-white border border-slate-200 hover:border-[#27AE60] shadow-lg flex items-center justify-center transition-all cursor-pointer active:scale-90"
                  title="Scroll Modal Up"
                >
                  <ChevronUp className="w-4 h-4 stroke-[3]" />
                </button>
                <button
                  onClick={scrollModalDown}
                  className="w-8 h-8 rounded-full bg-white hover:bg-[#27AE60] text-[#27AE60] hover:text-white border border-slate-200 hover:border-[#27AE60] shadow-lg flex items-center justify-center transition-all cursor-pointer active:scale-90"
                  title="Scroll Modal Down"
                >
                  <ChevronDown className="w-4 h-4 stroke-[3]" />
                </button>
              </div>

              {/* Modal footer controls */}
              <div className="p-4 bg-[#F9FBF9] border-t border-[#E0E0E0] flex justify-end gap-3">
                <button
                  id="close-details-bottom-btn"
                  onClick={() => setShowDetails(false)}
                  className="bg-white border border-[#E0E0E0] hover:bg-[#F5F5F5] text-[#1A1A1A] px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  Close Profile
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
