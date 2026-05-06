import { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const API_KEY = import.meta.env.VITE_PGA_API_KEY;
const API_BASE = "https://api.balldontlie.io/pga/v1";
const PICKS_PER_USER = 3;

export default function SharedPgaPoolApp() {
  const [user, setUser] = useState(null);
  const [poolCodeInput, setPoolCodeInput] = useState("");
  const [activePoolCode, setActivePoolCode] = useState("");
  const [poolSettings, setPoolSettings] = useState(null);
  const [members, setMembers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [fieldPlayers, setFieldPlayers] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [liveBoard, setLiveBoard] = useState({});
  const [selectedBoardPlayerId, setSelectedBoardPlayerId] = useState("");
  const [loadingTournaments, setLoadingTournaments] = useState(false);
  const [loadingField, setLoadingField] = useState(false);
  const [loadingScores, setLoadingScores] = useState(false);
  const [error, setError] = useState("");
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [search, setSearch] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [viewMode, setViewMode] = useState("pool");
  const [nickname, setNickname] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => setUser(nextUser));
    return () => unsub();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const poolFromUrl = params.get("pool");
    const savedPool = window.localStorage.getItem("pga_pool_code") || "";
    const savedTournament = window.localStorage.getItem("pga_tournament_id") || "";

    if (poolFromUrl) {
      const code = poolFromUrl.toUpperCase();
      setPoolCodeInput(code);
      setActivePoolCode(code);
    } else if (savedPool) {
      setPoolCodeInput(savedPool);
      setActivePoolCode(savedPool);
    }

    if (savedTournament) setSelectedTournamentId(savedTournament);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activePoolCode) window.localStorage.setItem("pga_pool_code", activePoolCode);
  }, [activePoolCode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedTournamentId) window.localStorage.setItem("pga_tournament_id", selectedTournamentId);
  }, [selectedTournamentId]);

  const apiFetch = async (path) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: API_KEY },
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  };

  const panelClass = "rounded-[24px] border border-stone-300 bg-white shadow-sm";
  const darkPanelClass = "rounded-[24px] border border-stone-700 bg-[#16321f] text-white shadow-sm";
  const buttonClass =
    "rounded-2xl px-4 py-2 bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed";
  const outlineButtonClass =
    "rounded-2xl px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed";

  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        setLoadingTournaments(true);
        setError("");
        const data = await apiFetch(`/tournaments?season=2026&per_page=100`);
        const list = (data.data || []).map((t) => ({
          id: String(t.id),
          name: t.name,
          status: t.status,
          venue: t.venue || "",
          startDate: t.start_date || "",
          endDate: t.end_date || "",
        }));

        setTournaments(list);

        if (!selectedTournamentId && list.length) {
          const savedTournament =
            typeof window !== "undefined" ? window.localStorage.getItem("pga_tournament_id") : "";
          const savedMatch = list.find((t) => t.id === savedTournament);
          const preferred = savedMatch || list.find((t) => t.status === "In Progress") || list[0];
          setSelectedTournamentId(preferred.id);
        }
      } catch (err) {
        console.error("Tournament load error:", err);
        setError(`Could not load tournaments: ${err.message}`);
      } finally {
        setLoadingTournaments(false);
      }
    };

    fetchTournaments();
  }, []);

  useEffect(() => {
    if (!selectedTournamentId) return;

    const fetchField = async () => {
      try {
        setLoadingField(true);
        setError("");

        let cursor = null;
        let keepGoing = true;
        let allPlayers = [];

        while (keepGoing) {
          const cursorParam = cursor ? `&cursor=${cursor}` : "";
          const data = await apiFetch(
            `/tournament_field?tournament_id=${selectedTournamentId}&per_page=100${cursorParam}`
          );

          allPlayers = [
            ...allPlayers,
            ...((data.data || []).map((entry) => ({
              id: String(entry.player.id),
              name: entry.player.display_name,
              country: entry.player.country || "",
            }))),
          ];

          cursor = data.meta?.next_cursor ?? null;
          keepGoing = Boolean(cursor);
        }

        allPlayers.sort((a, b) => a.name.localeCompare(b.name));
        setFieldPlayers(allPlayers);
      } catch (err) {
        console.error("Tournament field error:", err);
        setFieldPlayers([]);
        setError(`Could not load tournament field: ${err.message}`);
      } finally {
        setLoadingField(false);
      }
    };

    fetchField();
  }, [selectedTournamentId]);

  useEffect(() => {
    if (!selectedTournamentId) return;

    const fetchLiveLeaderboard = async () => {
      try {
        setLoadingScores(true);
        setError("");
        const data = await apiFetch(
          `/tournament_results?tournament_ids[]=${selectedTournamentId}&per_page=100`
        );

        const board = {};
        (data.data || []).forEach((result) => {
          const playerId = String(result.player.id);
          board[playerId] = {
            playerId,
            playerName: result.player.display_name,
            position: result.position,
            positionNumeric: result.position_numeric,
            toPar: Number(result.par_relative_score ?? 0),
            totalScore: Number(result.total_score ?? 0),
            earnings: result.earnings ?? null,
            country: result.player.country || "",
            raw: result,
          };
        });

        setLiveBoard(board);
        setLastUpdated(new Date());
        if (!selectedBoardPlayerId && Object.keys(board).length) {
          setSelectedBoardPlayerId(Object.keys(board)[0]);
        }
      } catch (err) {
        console.error("Live scoring error:", err);
        setLiveBoard({});
        setError(`Could not load live scoring: ${err.message}`);
      } finally {
        setLoadingScores(false);
      }
    };

    fetchLiveLeaderboard();
    const interval = setInterval(fetchLiveLeaderboard, 30000);
    return () => clearInterval(interval);
  }, [selectedTournamentId]);

  useEffect(() => {
    if (!activePoolCode) return;

    const unsubPool = onSnapshot(doc(db, "pools", activePoolCode), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPoolSettings(data);
        if (data.tournamentId) setSelectedTournamentId(data.tournamentId);
      } else {
        setPoolSettings(null);
      }
    });

    const unsubMembers = onSnapshot(collection(db, "pools", activePoolCode, "members"), (snapshot) => {
      setMembers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const picksQuery = query(collection(db, "picks"), where("pool", "==", activePoolCode));
    const unsubPicks = onSnapshot(picksQuery, (snapshot) => {
      setPicks(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubPool();
      unsubMembers();
      unsubPicks();
    };
  }, [activePoolCode]);

  const signIn = async () => signInWithPopup(auth, provider);
  const signOutUser = async () => signOut(auth);

  const isCommissioner = Boolean(user && poolSettings && user.uid === poolSettings.commissionerId);
  const draftOpen = poolSettings?.draftOpen ?? true;
  const draftOrder = poolSettings?.draftOrder || [];
  const currentPickIndex = poolSettings?.currentPickIndex ?? 0;
  const draftSeconds = poolSettings?.draftSeconds ?? 60;
  const currentDrafterId = draftOrder.length ? draftOrder[currentPickIndex % draftOrder.length] : "";
  const currentDrafter = members.find((member) => member.userId === currentDrafterId || member.id === currentDrafterId) || null;
  const pickStartedAtMillis = poolSettings?.currentPickStartedAtMillis || Date.now();
  const elapsedSeconds = Math.max(0, Math.floor((now - pickStartedAtMillis) / 1000));
  const remainingSeconds = Math.max(0, draftSeconds - elapsedSeconds);
  const currentRound = draftOrder.length ? Math.floor(currentPickIndex / draftOrder.length) + 1 : 1;

  const openDraft = async () => {
    if (!isCommissioner || !activePoolCode) return;
    await updateDoc(doc(db, "pools", activePoolCode), { draftOpen: true });
  };

  const closeDraft = async () => {
    if (!isCommissioner || !activePoolCode) return;
    await updateDoc(doc(db, "pools", activePoolCode), { draftOpen: false });
  };

  const setDraftOrderFromMembers = async () => {
    if (!isCommissioner || !activePoolCode || members.length === 0) return;
    const order = [...members]
      .sort((a, b) => (a.userName || "").localeCompare(b.userName || ""))
      .map((member) => member.userId || member.id);
    await updateDoc(doc(db, "pools", activePoolCode), {
      draftOrder: order,
      currentPickIndex: 0,
      currentPickStartedAtMillis: Date.now(),
      draftOpen: true,
    });
  };

  const shuffleDraftOrder = async () => {
    if (!isCommissioner || !activePoolCode || members.length === 0) return;
    const order = members.map((member) => member.userId || member.id);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    await updateDoc(doc(db, "pools", activePoolCode), {
      draftOrder: order,
      currentPickIndex: 0,
      currentPickStartedAtMillis: Date.now(),
      draftOpen: true,
    });
  };

  const nextPick = async () => {
    if (!isCommissioner || !activePoolCode || draftOrder.length === 0) return;
    await updateDoc(doc(db, "pools", activePoolCode), {
      currentPickIndex: currentPickIndex + 1,
      currentPickStartedAtMillis: Date.now(),
    });
  };

  const resetDraftClock = async () => {
    if (!isCommissioner || !activePoolCode) return;
    await updateDoc(doc(db, "pools", activePoolCode), {
      currentPickStartedAtMillis: Date.now(),
    });
  };
const displayName = nickname.trim() || user?.displayName || user?.email || "Player";
  const createPool = async () => {
    if (!user) return;
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    await setDoc(doc(db, "pools", code), {
      code,
      commissionerId: user.uid,
      commissionerName: displayName,
      picksPerUser: PICKS_PER_USER,
      tournamentId: selectedTournamentId || "",
      draftOpen: true,
      draftOrder: [],
      currentPickIndex: 0,
      draftSeconds: 60,
      currentPickStartedAtMillis: Date.now(),
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "pools", code, "members", user.uid), {
      userId: user.uid,
      userName: displayName,
      email: user.email || "",
      joinedAt: serverTimestamp(),
      role: "commissioner",
    });
    setActivePoolCode(code);
    setPoolCodeInput(code);
  };

  const joinPool = async () => {
    const code = poolCodeInput.trim().toUpperCase();
    if (!code || !user) return;
    const snap = await getDoc(doc(db, "pools", code));
    if (!snap.exists()) {
      setError("Pool not found.");
      return;
    }
    await setDoc(
      doc(db, "pools", code, "members", user.uid),
      {
        userId: user.uid,
        userName: displayName,
        email: user.email || "",
        joinedAt: serverTimestamp(),
        role: "member",
      },
      { merge: true }
    );
    setError("");
    setActivePoolCode(code);
  };

  const copyInviteLink = async () => {
    if (!activePoolCode || typeof window === "undefined") return;
    const url = `${window.location.origin}${window.location.pathname}?pool=${activePoolCode}`;
    await navigator.clipboard.writeText(url);
    setCopiedInvite(true);
    window.setTimeout(() => setCopiedInvite(false), 1500);
  };

  const selectedPlayer = useMemo(
    () => fieldPlayers.find((p) => p.id === selectedPlayerId) || null,
    [fieldPlayers, selectedPlayerId]
  );

  const myPicks = useMemo(
    () => picks.filter((p) => p.userId === user?.uid && p.tournamentId === selectedTournamentId),
    [picks, user, selectedTournamentId]
  );

  const takenPlayerIds = useMemo(
    () => new Set(picks.filter((p) => p.tournamentId === selectedTournamentId).map((p) => p.playerId)),
    [picks, selectedTournamentId]
  );

  const addPick = async () => {
    if (!user || !activePoolCode || !selectedTournamentId || !selectedPlayer || !draftOpen) return;
    if (draftOrder.length && user.uid !== currentDrafterId) return;
    if (myPicks.length >= PICKS_PER_USER) return;
    if (takenPlayerIds.has(selectedPlayer.id)) return;

    await addDoc(collection(db, "picks"), {
      pool: activePoolCode,
      tournamentId: selectedTournamentId,
      userId: user.uid,
      userName: displayName,
      playerId: selectedPlayer.id,
      golfer: selectedPlayer.name,
      createdAt: serverTimestamp(),
    });
    setSelectedPlayerId("");
  };

  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === selectedTournamentId) || null,
    [tournaments, selectedTournamentId]
  );

  const draftedLiveRows = useMemo(() => {
    return picks
      .filter((pick) => pick.tournamentId === selectedTournamentId)
      .map((pick) => {
        const live = liveBoard[pick.playerId] || null;
        return {
          ...pick,
          position: live?.position || "—",
          toPar: live?.toPar ?? null,
          totalScore: live?.totalScore ?? null,
          country: live?.country || "",
        };
      })
      .sort((a, b) => {
        const aScore = a.toPar ?? Number.MAX_SAFE_INTEGER;
        const bScore = b.toPar ?? Number.MAX_SAFE_INTEGER;
        return aScore - bScore || a.golfer.localeCompare(b.golfer);
      });
  }, [picks, selectedTournamentId, liveBoard]);

  const leaderboardRows = useMemo(() => {
    return Object.values(liveBoard)
      .filter((row) => row.playerName.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        const aPos = typeof a.positionNumeric === "number" ? a.positionNumeric : Number.MAX_SAFE_INTEGER;
        const bPos = typeof b.positionNumeric === "number" ? b.positionNumeric : Number.MAX_SAFE_INTEGER;
        return aPos - bPos || a.playerName.localeCompare(b.playerName);
      });
  }, [liveBoard, search]);

  const cutLine = useMemo(() => {
    if (!leaderboardRows.length) return null;
    const sortedScores = leaderboardRows
      .map((row) => row.toPar)
      .filter((score) => Number.isFinite(score))
      .sort((a, b) => a - b);
    return sortedScores.length >= 65 ? sortedScores[64] : sortedScores[sortedScores.length - 1] ?? null;
  }, [leaderboardRows]);

  const poolLeaderboard = useMemo(() => {
    const totals = {};
    picks
      .filter((pick) => pick.tournamentId === selectedTournamentId)
      .forEach((pick) => {
        const live = liveBoard[pick.playerId];
        const score = live?.toPar ?? 0;
        if (!totals[pick.userName]) totals[pick.userName] = { total: 0, picks: [] };
        totals[pick.userName].total += score;
        totals[pick.userName].picks.push({
          golfer: pick.golfer,
          position: live?.position || "—",
          score,
        });
      });

    return Object.entries(totals)
      .map(([userName, value]) => ({ userName, ...value }))
      .sort((a, b) => a.total - b.total || a.userName.localeCompare(b.userName));
  }, [picks, selectedTournamentId, liveBoard]);

  const selectedBoardPlayer = selectedBoardPlayerId ? liveBoard[selectedBoardPlayerId] : null;
  const tournamentLeader = leaderboardRows[0] || null;
  const poolLeader = poolLeaderboard[0] || null;
  const pickedCount = picks.filter((pick) => pick.tournamentId === selectedTournamentId).length;
  const totalPossiblePicks = Math.max(members.length, 1) * PICKS_PER_USER;
  const userCanPick =
    Boolean(user && activePoolCode && draftOpen) &&
    (!draftOrder.length || user.uid === currentDrafterId);

  const formatScore = (value) => {
    if (value === null || value === undefined) return "—";
    if (value === 0) return "E";
    return value > 0 ? `+${value}` : `${value}`;
  };

  const formatUpdated = (value) => {
    if (!value) return "—";
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  };

  const cutBadgeClass = (score) => {
    if (cutLine === null || score === null || score === undefined) return "bg-stone-100 text-stone-500";
    return score <= cutLine ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800";
  };

  const getCutStatus = (score) => {
    if (cutLine === null || score === null || score === undefined) return "—";
    return score <= cutLine ? "Making" : "Missing";
  };

  const hasPoolContext = Boolean(activePoolCode);
  const hasDraftedPlayers = draftedLiveRows.length > 0;

  return (
    <div className="max-w-7xl mx-auto p-3 md:p-6 grid gap-4 bg-[#f4f1e8] min-h-screen">
      <div className={darkPanelClass}>
        <div className="p-4 md:p-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-200">Live Coverage</div>
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-2">Shared PGA Pool Tracker</h1>
            <p className="text-sm md:text-base text-emerald-100/80 mt-2 max-w-2xl">
              Broadcast-style live leaderboard, pre-tournament draft room, and shared mobile scoring.
            </p>
          </div>
          <div className="flex flex-col items-start lg:items-end gap-2">
            {user ? (
              <>
                <div className="text-sm text-emerald-100">{user.displayName || user.email}</div>
                <button onClick={signOutUser} className="rounded-2xl px-4 py-2 bg-white text-[#16321f] hover:bg-emerald-50">
                  Sign Out
                </button>
              </>
            ) : (
              <button onClick={signIn} className="rounded-2xl px-4 py-2 bg-white text-[#16321f] hover:bg-emerald-50">
                Sign In with Google
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[24px] bg-[#071b11] text-white shadow-sm border border-stone-800 overflow-hidden">
        <div className="px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"></span>
            <span className="text-[11px] uppercase tracking-[0.25em] text-emerald-200">Live</span>
            <span className="text-sm text-white/80">{selectedTournament?.name || "Select a tournament"}</span>
          </div>
          <div className="text-sm text-white/70">Updated {formatUpdated(lastUpdated)} · Auto-refresh 30s</div>
        </div>

        <div className="grid gap-0 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200">Tournament Leader</div>
            <div className="mt-2 text-2xl font-bold truncate">{tournamentLeader?.playerName || "—"}</div>
            <div className="mt-1 text-4xl font-black tabular-nums text-white">
              {tournamentLeader ? formatScore(tournamentLeader.toPar) : "—"}
            </div>
          </div>

          <div className="p-4 bg-white/5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200">Projected Cut</div>
            <div className="mt-2 text-4xl font-black tabular-nums text-white">
              {cutLine === null ? "—" : formatScore(cutLine)}
            </div>
            <div className="text-sm text-white/70">Top 65 estimate</div>
          </div>

          <div className="p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200">Pool Leader</div>
            <div className="mt-2 text-2xl font-bold truncate">{poolLeader?.userName || "—"}</div>
            <div className={`mt-1 text-4xl font-black tabular-nums ${poolLeader?.total < 0 ? "text-emerald-300" : poolLeader?.total > 0 ? "text-red-300" : "text-white"}`}>
              {poolLeader ? formatScore(poolLeader.total) : "—"}
            </div>
          </div>
        </div>

        <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 bg-black/20 text-xs text-white/70">
          <span>
            Draft: <span className={draftOpen ? "text-emerald-300 font-semibold" : "text-red-300 font-semibold"}>{draftOpen ? "OPEN" : "LOCKED"}</span>
          </span>
          <span>On clock: <span className="font-semibold text-white">{currentDrafter?.userName || "Set order"}</span></span>
          <span>{pickedCount}/{totalPossiblePicks} picks made</span>
          <span>{selectedTournament?.status || "Tournament status unavailable"}</span>
        </div>
      </div>

      <div className={panelClass}>
  <div className="p-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_auto]">
    <input
      className="border rounded-2xl p-2 w-full"
      placeholder="Nickname"
      value={nickname}
      onChange={(e) => setNickname(e.target.value)}
    />
    <button onClick={createPool} disabled={!user} className={buttonClass}>Create Pool</button>
          <input
            className="border rounded-2xl p-2 w-full"
            placeholder="Enter Pool Code"
            value={poolCodeInput}
            onChange={(e) => setPoolCodeInput(e.target.value.toUpperCase())}
          />
          <button onClick={joinPool} disabled={!user} className={buttonClass}>Join Pool</button>
          <button onClick={copyInviteLink} disabled={!activePoolCode} className={outlineButtonClass}>
            {copiedInvite ? "Invite Copied" : "Copy Invite Link"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className={panelClass}>
          <div className="p-4 grid gap-3">
            <div className="text-lg font-semibold text-stone-900">Tournament</div>
            <select
              className="border rounded-2xl p-2"
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              disabled={loadingTournaments}
            >
              <option value="">{loadingTournaments ? "Loading tournaments..." : "Select tournament"}</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
              ))}
            </select>
          </div>
        </div>

        <div className={panelClass}>
          <div className="p-4 grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-stone-900">Live Draft Room</div>
                <div className="text-sm text-stone-500">Your picks: {myPicks.length}/{PICKS_PER_USER}</div>
              </div>
              <div className={`text-sm font-semibold ${draftOpen ? "text-green-700" : "text-red-700"}`}>
                {draftOpen ? "Draft Open" : "Draft Locked"}
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500">On The Clock</div>
              <div className="mt-1 text-xl font-bold text-stone-900">{currentDrafter?.userName || "Commissioner: set draft order"}</div>
              <div className={`mt-1 text-3xl font-black tabular-nums ${remainingSeconds <= 10 ? "text-red-700" : "text-emerald-700"}`}>
                {String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
              </div>
              {draftOrder.length > 0 && (
                <div className="mt-2 text-xs text-stone-500">
                  Order: {draftOrder.map((id) => members.find((m) => m.userId === id || m.id === id)?.userName || "Unknown").join(" → ")}
                </div>
              )}
            </div>

            {isCommissioner && (
              <div className="grid gap-2 md:grid-cols-2">
                <button onClick={setDraftOrderFromMembers} disabled={!members.length} className={outlineButtonClass}>Set Order A–Z</button>
                <button onClick={shuffleDraftOrder} disabled={!members.length} className={outlineButtonClass}>Randomize Order</button>
                <button onClick={openDraft} disabled={draftOpen} className={outlineButtonClass}>Open Draft</button>
                <button onClick={closeDraft} disabled={!draftOpen} className={outlineButtonClass}>Lock Draft</button>
                <button onClick={nextPick} disabled={!draftOrder.length} className={outlineButtonClass}>Next Pick</button>
                <button onClick={resetDraftClock} disabled={!activePoolCode} className={outlineButtonClass}>Reset Clock</button>
              </div>
            )}

            <select
              className="border rounded-2xl p-2"
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              disabled={!userCanPick || loadingField || !fieldPlayers.length || myPicks.length >= PICKS_PER_USER}
            >
              <option value="">{loadingField ? "Loading tournament field..." : userCanPick ? "Select golfer" : "Waiting for your turn"}</option>
              {fieldPlayers.map((player) => (
                <option key={player.id} value={player.id} disabled={takenPlayerIds.has(player.id)}>
                  {player.name}{takenPlayerIds.has(player.id) ? " — taken" : ""}
                </option>
              ))}
            </select>

            <button
              onClick={addPick}
              disabled={!userCanPick || !selectedPlayerId || myPicks.length >= PICKS_PER_USER}
              className={buttonClass}
            >
              Add Pick
            </button>
          </div>
        </div>
      </div>

      <div className={darkPanelClass}>
        <div className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm text-emerald-100/80">App opens back to your saved pool and tournament.</div>
            <div className="text-sm font-medium text-white">
              Current view: {viewMode === "pool" ? "Your drafted golfers" : "Full tournament board"}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className={viewMode === "pool"
                ? "rounded-2xl px-4 py-2 bg-white text-[#16321f] hover:bg-emerald-50"
                : "rounded-2xl px-4 py-2 border border-emerald-300/40 text-white hover:bg-white/10"}
              onClick={() => setViewMode("pool")}
            >
              My Pool Scores
            </button>
            <button
              className={viewMode === "all"
                ? "rounded-2xl px-4 py-2 bg-white text-[#16321f] hover:bg-emerald-50"
                : "rounded-2xl px-4 py-2 border border-emerald-300/40 text-white hover:bg-white/10"}
              onClick={() => setViewMode("all")}
            >
              Full Leaderboard
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className={panelClass}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-2xl md:text-3xl font-semibold tracking-tight text-stone-900">
                {viewMode === "pool" ? "Your Drafted Golfers Live Scores" : "Live Leaderboard"}
              </div>
              <div className="text-sm text-stone-500">{loadingScores ? "Refreshing..." : `Updated ${formatUpdated(lastUpdated)}`}</div>
            </div>

            {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

            {viewMode === "pool" ? (
              hasDraftedPlayers ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-300 text-[11px] uppercase tracking-[0.18em] text-stone-500">
                        <th className="text-left py-2">Owner</th>
                        <th className="text-left py-2">Golfer</th>
                        <th className="text-left py-2">Pos</th>
                        <th className="text-left py-2">To Par</th>
                        <th className="text-left py-2">Total</th>
                        <th className="text-left py-2">Cut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftedLiveRows.map((row) => (
                        <tr key={row.id} className="border-b border-stone-200 hover:bg-stone-50">
                          <td className="py-3 font-medium">{row.userName}</td>
                          <td className="py-3">{row.golfer}</td>
                          <td className="py-3">{row.position}</td>
                          <td className={`py-3 text-xl md:text-2xl tabular-nums ${row.toPar < 0 ? "text-green-700 font-bold" : row.toPar > 0 ? "text-red-700 font-bold" : "font-bold text-stone-700"}`}>
                            {formatScore(row.toPar)}
                          </td>
                          <td className="py-3 tabular-nums">{Number.isFinite(row.totalScore) ? row.totalScore : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-stone-500">Once your group drafts golfers, this screen will reopen directly to their live scores.</div>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-300 text-[11px] uppercase tracking-[0.18em] text-stone-500">
                      <th className="text-left py-2">Pos</th>
                      <th className="text-left py-2">Player</th>
                      <th className="text-left py-2">Country</th>
                      <th className="text-left py-2">To Par</th>
                      <th className="text-left py-2">Total</th>
                      <th className="text-left py-2">Cut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardRows.map((row, index) => (
                      <tr
                        key={row.playerId}
                        className={`border-b border-stone-200 cursor-pointer ${index === 0 ? "bg-emerald-50" : ""} ${selectedBoardPlayerId === row.playerId ? "bg-stone-100" : "hover:bg-stone-50"}`}
                        onClick={() => setSelectedBoardPlayerId(row.playerId)}
                      >
                        <td className="py-3 font-semibold tabular-nums">{row.position || "—"}</td>
                        <td className="py-3 font-semibold text-stone-900">{row.playerName}</td>
                        <td className="py-3">{row.country || "—"}</td>
                        <td className={`py-3 text-xl md:text-2xl tabular-nums ${row.toPar < 0 ? "text-green-700 font-bold" : row.toPar > 0 ? "text-red-700 font-bold" : "font-bold text-stone-700"}`}>
                          {formatScore(row.toPar)}
                        </td>
                        <td className="py-3 tabular-nums">{Number.isFinite(row.totalScore) ? row.totalScore : "—"}</td>
                        <td className="py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${cutBadgeClass(row.toPar)}`}>
                            {getCutStatus(row.toPar)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <div className={panelClass}>
            <div className="p-4">
              <div className="text-lg md:text-xl font-semibold mb-3 text-stone-900">Pool Leaderboard</div>
              {poolLeaderboard.length === 0 ? (
                <div className="text-sm text-stone-500">No picks yet.</div>
              ) : (
                <div className="grid gap-2">
                  {poolLeaderboard.map((entry, index) => (
                    <div key={entry.userName} className={`border rounded-2xl p-3 ${index === 0 ? "bg-emerald-50 border-emerald-300" : "bg-white"}`}>
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{entry.userName}</div>
                        <div className={entry.total < 0 ? "text-green-700 text-xl font-bold tabular-nums" : entry.total > 0 ? "text-red-700 text-xl font-bold tabular-nums" : "text-xl font-bold text-stone-700 tabular-nums"}>
                          {formatScore(entry.total)}
                        </div>
                      </div>
                      <div className="grid gap-1 mt-2">
                        {entry.picks.map((pick, i) => (
                          <div key={`${pick.golfer}-${i}`} className="flex items-center justify-between text-sm">
                            <div>{pick.golfer}</div>
                            <div>{pick.position} · {formatScore(pick.score)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={panelClass}>
            <div className="p-4">
              <div className="text-lg md:text-xl font-semibold mb-3 text-stone-900">Pool Members</div>
              {members.length === 0 ? (
                <div className="text-sm text-stone-500">No members yet.</div>
              ) : (
                <div className="grid gap-2">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between border rounded-2xl p-3">
                      <div>
                        <div className="font-medium">{member.userName}</div>
                        <div className="text-xs text-stone-500">{member.email || member.userId}</div>
                      </div>
                      <div className="text-sm text-stone-500">{member.role}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
