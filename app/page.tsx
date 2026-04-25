"use client";
import { useState, useEffect, useRef } from 'react';

export default function FindTheJudas() {
  const [state, setState] = useState({
    view: 'home',
    roomId: '',
    playerName: '',
    role: '',
    isPlaying: false,
    lastWord: '',
    judasCount: 1,
    currentRound: 0
  });
  const [lobbyData, setLobbyData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'error' });
  const [confirm, setConfirm] = useState({ show: false, msg: '', action: () => {} });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- Restore Session on Mount ---
  useEffect(() => {
    const saved = localStorage.getItem('ftj_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        localStorage.removeItem('ftj_session');
      }
    }
  }, []);

  // --- Helper Functions ---
  const showToast = (msg: string, type = 'error') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
  };

  const fetchAPI = async (action: string, payload: any, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      return data.data;
    } catch (error: any) {
      if (!silent) showToast(error.message);
      throw error;
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const updateState = (val: any) => {
    setState(prev => {
      const newState = { ...prev, ...val };
      localStorage.setItem('ftj_session', JSON.stringify(newState));
      return newState;
    });
  };

  // --- Game Logic ---
  const handleCreateRoom = async () => {
    if (!state.playerName.trim()) return showToast("Sebutkan namamu!");
    try {
      const data = await fetchAPI('createRoom', { wasitName: state.playerName });
      updateState({ roomId: data.roomId, role: 'WASIT', view: 'wasit', currentRound: 0 });
    } catch (e) {}
  };

  const handleJoinRoom = async () => {
    if (!state.playerName.trim() || !state.roomId.trim()) return showToast("Data belum lengkap!");
    try {
      await fetchAPI('joinRoom', { 
        roomId: state.roomId.toUpperCase(), 
        playerName: state.playerName 
      });
      updateState({ role: 'PEMAIN', view: 'player', roomId: state.roomId.toUpperCase() });
    } catch (e) {}
  };

  const handleStartGame = async () => {
    const cw = (document.getElementById('cw') as HTMLInputElement)?.value;
    const jw = (document.getElementById('jw') as HTMLInputElement)?.value;
    
    if (!cw || !jw) return showToast("Lengkapi sabda rahasia!");
    
    try {
      const res = await fetchAPI('startGame', { 
          roomId: state.roomId, 
          citizenWord: cw, 
          judasWord: jw, 
          judasCount: state.judasCount 
      });
      // Backend akan mengembalikan roundCount terbaru
      const newRound = res.roundCount || (state.currentRound + 1);
      updateState({ currentRound: newRound });
      showToast(`✅ SABDA RONDE ${newRound} TERSEBAR!`, "success");
    } catch (e) {}
  };

  // Fungsi untuk Kick Pemain (Hanya Wasit)
  const handleKickPlayer = (targetName: string) => {
    if (targetName === state.playerName) return showToast("Anda tidak bisa kick diri sendiri!");
    
    setConfirm({
      show: true,
      msg: `Kick "${targetName}" dari room?`,
      action: async () => {
        try {
          await fetchAPI('kickPlayer', { roomId: state.roomId, targetName });
          setConfirm({ ...confirm, show: false });
          showToast(`Berhasil mengeluarkan ${targetName}`, "success");
        } catch (e) {}
      }
    });
  };

  const handleExitGame = () => {
    if (state.role === 'WASIT') {
      setConfirm({
        show: true,
        msg: "Hapus data & tutup room selamanya?",
        action: async () => {
          try {
            await fetchAPI('closeRoom', { roomId: state.roomId });
            handleLogout();
          } catch (e) {
            handleLogout();
          }
        }
      });
    } else {
      handleLogout();
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('ftj_session');
    window.location.reload();
  };

  // --- Polling Lobby ---
  useEffect(() => {
    if (!state.roomId || state.view === 'home') return;

    const poll = async () => {
      try {
        const data = await fetchAPI('getLobby', { roomId: state.roomId }, true);
        setLobbyData(data);
        
        // Pengecekan apakah saya di-kick oleh wasit
        const isMeStillHere = data.players.some((p: any) => p.name === state.playerName);
        if (state.role === 'PEMAIN' && !isMeStillHere) {
          showToast("Anda telah dikeluarkan oleh wasit.");
          handleLogout();
          return;
        }
        if (state.role === 'PEMAIN' && data.status === 'PLAYING') {
          const me = data.players.find((p: { name: string; }) => p.name === state.playerName);
          // Jika status PLAYING tapi view masih di 'player', paksa masuk ke 'game'
          if (me && me.word && (data.roundCount > state.currentRound || state.view === 'player')) {
            updateState({ 
              lastWord: me.word, 
              view: 'game', 
              currentRound: data.roundCount 
            });
          }
        }

        if (state.role === 'PEMAIN' && data.status === 'PLAYING') {
          const me = data.players.find((p: any) => p.name === state.playerName);
          // Cek berdasarkan roundCount dari server
          if (me && me.word && data.roundCount > state.currentRound) {
            updateState({ lastWord: me.word, view: 'game', currentRound: data.roundCount });
            showToast(`🔔 RONDE BARU ${data.roundCount}!`, "success");
          }
        }
        
        // Update round count lokal untuk wasit agar sinkron
        if (state.role === 'WASIT' && data.roundCount !== state.currentRound) {
            updateState({ currentRound: data.roundCount });
        }

      } catch (e: any) {
        if (e.message?.toLowerCase().includes("tidak ditemukan") || e.message?.toLowerCase().includes("berakhir")) {
          showToast("Wasit telah menutup room.");
          setTimeout(handleLogout, 2000);
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 4000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.roomId, state.view, state.playerName, state.currentRound]);

  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans selection:bg-red-500/30 relative">
      
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[9999] px-6 py-3 rounded-xl shadow-2xl border border-white/10 text-sm font-bold animate-bounce ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Confirmation Modal */}
      {confirm.show && (
        <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 text-center">
          <div className="bg-slate-800 border border-slate-700 p-8 rounded-[2.5rem] w-full max-w-xs shadow-2xl">
            <p className="text-white font-bold mb-8 leading-relaxed uppercase tracking-widest text-xs italic opacity-80">{confirm.msg}</p>
            <div className="flex gap-4">
              <button 
                onClick={() => setConfirm({ ...confirm, show: false })}
                className="flex-1 py-3 rounded-2xl bg-slate-700 text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                Batal
              </button>
              <button 
                onClick={confirm.action}
                className="flex-1 py-3 rounded-2xl bg-red-600 text-xs font-black uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-red-900/20"
              >
                Ya, Eksekusi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-[9998] bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-red-500 rounded-full animate-spin mb-4" />
          <p className="text-xs font-black tracking-[0.3em] uppercase opacity-50">Sinkronisasi...</p>
        </div>
      )}

      <div className="max-w-md mx-auto min-h-screen flex flex-col px-6 py-10 bg-gradient-to-b from-slate-800 to-slate-950 shadow-2xl">
        
        {/* Logo Section */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-yellow-500 uppercase">
            Find The Judas
          </h1>
          <p className="text-[10px] uppercase font-bold tracking-[0.4em] text-slate-500 mt-1">Trust No One</p>
        </div>

        {/* VIEW: HOME */}
        {state.view === 'home' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1 text-center block">Identitas Anda</label>
              <input 
                type="text" 
                placeholder="Masukkan Nama..." 
                className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-5 py-4 focus:outline-none focus:border-red-500 transition-all font-bold text-center"
                value={state.playerName}
                onChange={(e) => setState({...state, playerName: e.target.value})}
              />
            </div>

            <div className="p-6 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-4">
              <h2 className="text-center font-bold text-red-500 uppercase tracking-widest text-xs">Opsi Host</h2>
              <button onClick={handleCreateRoom} className="w-full bg-red-600 hover:bg-red-700 py-4 rounded-2xl font-black shadow-lg shadow-red-900/20 active:scale-95 transition-all text-xs uppercase tracking-widest">
                Buat Room Baru 🔥
              </button>
            </div>

            <div className="p-6 rounded-[2rem] bg-white/[0.03] border border-white/5 space-y-4">
              <h2 className="text-center font-bold text-blue-500 uppercase tracking-widest text-xs">Opsi Pemain</h2>
              <input 
                type="text" 
                placeholder="KODE ROOM" 
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-center font-mono uppercase tracking-[0.5em] focus:outline-none focus:border-blue-500"
                value={state.roomId}
                onChange={(e) => setState({...state, roomId: e.target.value.toUpperCase()})}
              />
              <button onClick={handleJoinRoom} className="w-full bg-blue-600 hover:bg-blue-700 py-4 rounded-2xl font-black active:scale-95 transition-all text-xs uppercase tracking-widest">
                Gabung Room 🎯
              </button>
            </div>
          </div>
        )}

        {/* VIEW: WASIT / LOBBY */}
        {(state.view === 'wasit' || state.view === 'player') && (
          <div className="flex-1 flex flex-col animate-in zoom-in-95 duration-300">
            <div className="bg-slate-800/50 p-6 rounded-[2.5rem] border border-white/5 mb-6 flex justify-between items-center shadow-xl relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Room Code</p>
                <h2 className="text-4xl font-mono font-black tracking-widest">{state.roomId}</h2>
              </div>
              <div className="text-right relative z-10">
                <div className={`px-4 py-1 rounded-full text-[10px] font-black uppercase border mb-2 ${state.role === 'WASIT' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 'bg-blue-500/10 text-blue-500 border-blue-500/20'}`}>
                    {state.role}
                </div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Ronde Aktif: {state.currentRound}</p>
              </div>
              <div className="absolute -right-4 -bottom-4 text-white opacity-[0.03] text-8xl font-black italic select-none">
                #{state.currentRound}
              </div>
            </div>

            {state.role === 'WASIT' && (
              <div className="bg-white/[0.03] border border-white/5 p-6 rounded-[2rem] mb-6 space-y-4 border-yellow-500/10 shadow-lg shadow-yellow-500/5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-500 uppercase ml-1">Apostle Word</label>
                    <input id="cw" type="text" placeholder="Mobil" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-500 transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-500 uppercase ml-1">Judas Word</label>
                    <input id="jw" type="text" placeholder="Motor" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-red-500 transition-colors" />
                  </div>
                </div>
                
                <div className="flex justify-between items-center bg-black/20 p-3 rounded-xl border border-white/5">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Jumlah Judas</label>
                  <input 
                    type="number" 
                    value={state.judasCount} 
                    min="1" 
                    className="w-12 bg-slate-800 text-center rounded-lg text-white py-1 font-black text-xs border border-slate-700 outline-none"
                    onChange={(e) => setState({...state, judasCount: parseInt(e.target.value) || 1})}
                  />
                </div>

                <button 
                  onClick={handleStartGame}
                  className="w-full bg-gradient-to-r from-red-600 to-orange-500 py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] active:scale-95 transition-all shadow-xl shadow-red-900/20"
                >
                  Bagikan Ronde {state.currentRound + 1} 🔥
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto mb-6 pr-1 custom-scrollbar">
               <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-4 ml-2 flex justify-between items-center">
                  <span>Pemain Aktif ({lobbyData?.players.length || 0})</span>
                  {state.role === 'WASIT' && <span className="text-[7px] lowercase opacity-40 font-normal italic">klik (X) untuk kick</span>}
               </h3>
               <div className="space-y-3">
                 {lobbyData?.players.map((p: any, i: number) => (
                   <div key={i} className="group flex justify-between items-center bg-white/[0.03] p-4 rounded-2xl border border-white/5 hover:bg-white/[0.06] transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center font-black text-[11px] text-slate-500 border border-white/5 shadow-inner">{p.name[0].toUpperCase()}</div>
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-200">
                                {p.name} {p.name === state.playerName && <span className="text-blue-500 ml-1 text-[8px] opacity-60 italic">#Anda</span>}
                            </span>
                            {state.role === 'WASIT' && (
                                <span className="text-[7px] text-slate-500 uppercase font-bold tracking-widest">ID: {p.name.substring(0,4)}...</span>
                            )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        {state.role === 'WASIT' && lobbyData.status === 'PLAYING' && (
                            <div className="text-right">
                                <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded ${p.isJudas ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'}`}>{p.isJudas ? 'Judas' : 'Apostle'}</span>
                                <p className="text-[8px] font-bold text-slate-500 mt-1 uppercase opacity-60">{p.word}</p>
                            </div>
                        )}
                        
                        {state.role === 'WASIT' && p.name !== state.playerName && (
                            <button 
                                onClick={() => handleKickPlayer(p.name)}
                                className="w-8 h-8 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20 hover:bg-red-600 hover:text-white transition-all active:scale-90"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        )}
                      </div>
                   </div>
                 ))}
               </div>
            </div>

            <button onClick={handleExitGame} className={`w-full py-4 text-[9px] font-black uppercase tracking-[0.3em] transition-colors underline ${state.role === 'WASIT' ? 'text-red-500 hover:text-red-400' : 'text-slate-600 hover:text-white'}`}>
              {state.role === 'WASIT' ? '🔥 Tutup Room & Hapus Data' : 'Keluar dari Room'}
            </button>
          </div>
        )}

        {/* VIEW: GAME CARD */}
        {state.view === 'game' && (
          <div className="flex-1 flex flex-col items-center justify-center animate-in zoom-in-95 duration-500">
            <div className="text-center mb-10">
              <span className="px-5 py-1.5 rounded-full bg-green-500/10 text-green-500 text-[9px] font-black uppercase border border-green-500/20 tracking-[0.5em] shadow-lg shadow-green-500/5">Ronde {state.currentRound} Diterima</span>
              <h2 className="text-3xl font-black mt-6 uppercase italic tracking-tighter">Sabda Rahasia</h2>
            </div>

            <div 
              onMouseDown={() => setIsRevealed(true)}
              onMouseUp={() => setIsRevealed(false)}
              onTouchStart={(e) => { e.preventDefault(); setIsRevealed(true); }}
              onTouchEnd={(e) => { e.preventDefault(); setIsRevealed(false); }}
              className={`w-64 aspect-[3/4] rounded-[3.5rem] border-2 transition-all duration-500 relative overflow-hidden cursor-pointer select-none ${isRevealed ? 'bg-gradient-to-br from-blue-900 via-slate-900 to-black border-blue-500 shadow-[0_0_60px_rgba(59,130,246,0.4)] scale-105' : 'bg-slate-800 border-slate-700 shadow-2xl'}`}
            >
              {!isRevealed ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                  <div className="text-7xl opacity-10 mb-8 grayscale text-center">🗝️</div>
                  <p className="text-[11px] font-black uppercase text-slate-500 tracking-[0.4em] text-center">Pegang & Tahan</p>
                  <p className="text-[8px] text-slate-600 mt-4 uppercase font-bold tracking-widest">Intip Sabda Ronde {state.currentRound}</p>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
                  <p className="text-[9px] font-black uppercase text-blue-500 tracking-[0.6em] mb-10 opacity-50 text-center text-nowrap">Sabda Anda Adalah:</p>
                  <h3 className="text-5xl font-black uppercase italic drop-shadow-2xl text-center leading-tight tracking-tighter">{state.lastWord}</h3>
                  <div className="mt-14 w-16 h-1.5 bg-blue-500/20 rounded-full animate-pulse mx-auto shadow-[0_0_15px_rgba(59,130,246,0.3)]" />
                </div>
              )}
            </div>

            <button onClick={() => updateState({ view: 'player' })} className="mt-12 text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-white transition-all border-b-2 border-slate-800 hover:border-blue-500 pb-1">
              Tutup Kartu
            </button>
          </div>
        )}

        <footer className="mt-auto pt-10 text-center opacity-20 italic flex flex-col items-center gap-1">
          <code className="text-[8px] uppercase tracking-widest font-black">Petrus David Adi Pranata</code>
          <p className="text-[7px] uppercase font-bold tracking-tighter">System Version 2.1 • Next.js Edition</p>
        </footer>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.01); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
      `}</style>
    </div>
  );
}