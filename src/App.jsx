import { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  getAuth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const API_KEY = import.meta.env.VITE_PGA_API_KEY;
const API_BASE = "https://api.balldontlie.io/pga/v1";
const PICKS_PER_USER = 3;
const DEFAULT_PICK_SECONDS = 60;
const FALLBACK_PLAYERS = [
  { id: "p1", name: "Scottie Scheffler" },
  { id: "p2", name: "Rory McIlroy" },
  { id: "p3", name: "Jon Rahm" },
  { id: "p4", name: "Xander Schauffele" },
  { id: "p5", name: "Collin Morikawa" },
  { id: "p6", name: "Ludvig Åberg" },
  { id: "p7", name: "Viktor Hovland" },
  { id: "p8", name: "Patrick Cantlay" },
  { id: "p9", name: "Justin Thomas" },
  { id: "p10", name: "Jordan Spieth" },
  { id: "p11", name: "Hideki Matsuyama" },
  { id: "p12", name: "Tommy Fleetwood" },
  { id: "p13", name: "Brooks Koepka" },
  { id: "p14", name: "Bryson DeChambeau" },
  { id: "p15", name: "Max Homa" },
  { id: "p16", name: "Tony Finau" },
  { id: "p17", name: "Sam Burns" },
  { id: "p18", name: "Matt Fitzpatrick" },
  { id: "p19", name: "Sungjae Im" },
  { id: "p20", name: "Wyndham Clark" },
  { id: "p21", name: "Keegan Bradley" },
  { id: "p22", name: "Russell Henley" },
  { id: "p23", name: "Sahith Theegala" },
  { id: "p24", name: "Cameron Young" },
  { id: "p25", name: "Tom Kim" },
  { id: "p26", name: "Rickie Fowler" },
  { id: "p27", name: "Corey Conners" },
  { id: "p28", name: "Dustin Johnson" },
  { id: "p29", name: "Cameron Smith" },
  { id: "p30", name: "Tyrrell Hatton" },
  { id: "p31", name: "Joaquín Niemann" },
  { id: "p32", name: "Min Woo Lee" },
  { id: "p33", name: "Shane Lowry" },
  { id: "p34", name: "Jason Day" },
  { id: "p35", name: "Brian Harman" },
  { id: "p36", name: "Robert MacIntyre" },
  { id: "p37", name: "Akshay Bhatia" },
  { id: "p38", name: "Denny McCarthy" },
  { id: "p39", name: "Si Woo Kim" },
  { id: "p40", name: "Adam Scott" },
  { id: "p41", name: "Sepp Straka" },
  { id: "p42", name: "Harris English" },
  { id: "p43", name: "Billy Horschel" },
  { id: "p44", name: "Will Zalatoris" },
  { id: "p45", name: "Lucas Glover" },
  { id: "p46", name: "J.T. Poston" },
  { id: "p47", name: "Kurt Kitayama" },
  { id: "p48", name: "Maverick McNealy" },
  { id: "p49", name: "Cameron Davis" },
  { id: "p50", name: "Byeong Hun An" }
];
function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardStyle() {
  return "rounded-2xl bg-white shadow-sm border border-slate-200";
}

function buttonBase(variant = "solid") {
  const common = "rounded-2xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  if (variant === "outline") {
    return `${common} border border-slate-300 bg-white hover:bg-slate-50`;
  }
  return `${common} bg-emerald-700 text-white hover:bg-emerald-800`;
}

export default function GolfPoolSnakeDraftApp() {
  const [user, setUser] = useState(null);
  const [poolCodeInput, setPoolCodeInput] = useState("");
  const [activePoolCode, setActivePoolCode] = useState("");
  const [poolSettings, setPoolSettings] = useState(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [picks, setPicks] = useState([]);
  const [liveBoard, setLiveBoard] = useState({});
  const [tournaments, setTournaments] = useState([]);
  const [fieldPlayers, setFieldPlayers] = useState([]);
  const [loadingField, setLoadingField] = useState(false);
  const [error, setError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [members, setMembers] = useState([]);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [busyReset, setBusyReset] = useState(false);
  const [pickCountdown, setPickCountdown] = useState(DEFAULT_PICK_SECONDS);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => setUser(nextUser));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const poolFromUrl = params.get("pool");
    if (poolFromUrl && !activePoolCode) setPoolCodeInput(poolFromUrl.toUpperCase());
  }, [activePoolCode]);

  const apiFetch = async (path) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: API_KEY },
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  };

  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        const data = await apiFetch(`/tournaments?season=2026&per_page=100`);
        setTournaments((data.data || []).map((t) => ({
          id: String(t.id),
          name: t.name,
          status: t.status,
        })));
      } catch {
        setError("Could not load tournaments. Check your PGA API key.");
      }
    };
    fetchTournaments();
  }, []);

useEffect(() => {
  if (!selectedTournamentId) return;

  const fetchLiveLeaderboard = async () => {
    try {
      const data = await apiFetch(
        `/tournament_results?tournament_ids[]=${selectedTournamentId}&per_page=100`
      );

      const board = {};
      (data.data || []).forEach((result) => {
        board[String(result.player.id)] = {
          position: result.position,
          positionNumeric: result.position_numeric,
          toPar: Number(result.par_relative_score ?? 0),
          totalScore: Number(result.total_score ?? 0),
          playerName: result.player.display_name,
        };
      });

      setLiveBoard(board);
    } catch (err) {
      console.error("Live leaderboard error:", err);
      setLiveBoard({});
      setError(`Could not load live scoring: ${err.message}`);
    }
  };

  fetchLiveLeaderboard();
  const interval = setInterval(fetchLiveLeaderboard, 60000);
  return () => clearInterval(interval);
}, [selectedTournamentId]);

  useEffect(() => {
  setLiveBoard({});
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

    const q = query(collection(db, "picks"), where("pool", "==", activePoolCode));
    const unsubPicks = onSnapshot(q, (snapshot) => {
      setPicks(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubMembers = onSnapshot(collection(db, "pools", activePoolCode, "members"), (snapshot) => {
      setMembers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubPool();
      unsubPicks();
      unsubMembers();
    };
  }, [activePoolCode]);

  const signIn = async () => signInWithPopup(auth, provider);
  const signOutUser = async () => signOut(auth);

  const createPool = async () => {
    if (!user) return;
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const defaultTournamentId = tournaments[0]?.id || "";
    await setDoc(doc(db, "pools", code), {
      code,
      commissionerId: user.uid,
      commissionerName: user.displayName || user.email,
      locked: false,
      picksPerUser: PICKS_PER_USER,
      allowDuplicates: false,
      draftType: "snake",
      draftStatus: "setup",
      currentPickNumber: 1,
      draftOrder: [user.uid],
      pickSeconds: DEFAULT_PICK_SECONDS,
      pickStartedAtMs: null,
      tournamentId: defaultTournamentId,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "pools", code, "members", user.uid), {
      userId: user.uid,
      userName: user.displayName || user.email,
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
        userName: user.displayName || user.email,
        email: user.email || "",
        joinedAt: serverTimestamp(),
        role: "member",
      },
      { merge: true }
    );
    setError("");
    setActivePoolCode(code);
  };

  const isCommissioner = Boolean(user && poolSettings && user.uid === poolSettings.commissionerId);
  const picksPerUser = poolSettings?.picksPerUser ?? PICKS_PER_USER;
  const locked = Boolean(poolSettings?.locked);
  const draftStatus = poolSettings?.draftStatus ?? "setup";
  const pickSeconds = poolSettings?.pickSeconds ?? DEFAULT_PICK_SECONDS;

  const membersSorted = useMemo(() => {
    return members
      .slice()
      .sort((a, b) => {
        const aj = a.joinedAt?.seconds || 0;
        const bj = b.joinedAt?.seconds || 0;
        return aj - bj || (a.userName || "").localeCompare(b.userName || "");
      });
  }, [members]);

  const setupOrder = useMemo(() => {
    const savedOrder = poolSettings?.draftOrder || [];
    const validSaved = savedOrder.filter((uid) => membersSorted.some((m) => m.userId === uid));
    const missing = membersSorted.map((m) => m.userId).filter((uid) => !validSaved.includes(uid));
    return [...validSaved, ...missing];
  }, [poolSettings, membersSorted]);

  const draftOrder = useMemo(() => {
    const ids = setupOrder;
    const rounds = [];
    for (let r = 0; r < picksPerUser; r++) {
      rounds.push(r % 2 === 0 ? ids : [...ids].reverse());
    }
    return rounds.flat();
  }, [setupOrder, picksPerUser]);

  const currentPickNumber = poolSettings?.currentPickNumber ?? 1;
  const totalDraftPicks = draftOrder.length;
  const currentTurnUserId = currentPickNumber <= totalDraftPicks ? draftOrder[currentPickNumber - 1] : null;
  const currentTurnMember = membersSorted.find((m) => m.userId === currentTurnUserId);

  useEffect(() => {
    const updateCountdown = () => {
      if (draftStatus !== "live" || !poolSettings?.pickStartedAtMs) {
        setPickCountdown(pickSeconds);
        return;
      }
      const elapsed = Math.floor((Date.now() - poolSettings.pickStartedAtMs) / 1000);
      const remaining = Math.max(0, pickSeconds - elapsed);
      setPickCountdown(remaining);
    };

    updateCountdown();
    if (draftStatus !== "live") return;
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [draftStatus, poolSettings?.pickStartedAtMs, pickSeconds]);

  const picksInTournament = useMemo(() => picks.filter((p) => p.tournamentId === selectedTournamentId), [picks, selectedTournamentId]);
  const myPicks = useMemo(() => picksInTournament.filter((p) => p.userId === user?.uid), [picksInTournament, user]);
  const takenPlayerIds = useMemo(() => new Set(picksInTournament.map((p) => p.playerId)), [picksInTournament]);
  const selectedPlayer = useMemo(() => fieldPlayers.find((p) => p.id === selectedPlayerId) || null, [fieldPlayers, selectedPlayerId]);

  const canDraft = Boolean(
    user &&
      activePoolCode &&
      selectedTournamentId &&
      selectedPlayer &&
      draftStatus === "live" &&
      !locked &&
      currentTurnUserId === user.uid &&
      myPicks.length < picksPerUser &&
      !takenPlayerIds.has(selectedPlayer.id)
  );

  const advanceDraft = async (nextPickNumber) => {
    const finished = nextPickNumber > totalDraftPicks;
    await updateDoc(doc(db, "pools", activePoolCode), {
      currentPickNumber: nextPickNumber,
      draftStatus: finished ? "finished" : "live",
      locked: finished,
      pickStartedAtMs: finished ? null : Date.now(),
    });
  };

  const makeDraftPick = async () => {
    if (!canDraft || !selectedPlayer) return;

    await addDoc(collection(db, "picks"), {
      pool: activePoolCode,
      tournamentId: selectedTournamentId,
      userId: user.uid,
      userName: user.displayName || user.email,
      playerId: selectedPlayer.id,
      golfer: selectedPlayer.name,
      draftPickNumber: currentPickNumber,
      createdAt: serverTimestamp(),
    });

    await advanceDraft(currentPickNumber + 1);
    setSelectedPlayerId("");
  };

  const removePick = async (pickId) => {
    if (!user || !pickId) return;
    const pick = picks.find((p) => p.id === pickId);
    if (!pick || (pick.userId !== user.uid && !isCommissioner)) return;
    await deleteDoc(doc(db, "picks", pickId));
  };

  const updateSetting = async (field, value) => {
    if (!isCommissioner || !activePoolCode) return;
    setSavingSettings(true);
    await updateDoc(doc(db, "pools", activePoolCode), { [field]: value });
    setSavingSettings(false);
  };

  const saveDraftOrder = async (newOrder) => {
    if (!isCommissioner || !activePoolCode || draftStatus === "live") return;
    await updateDoc(doc(db, "pools", activePoolCode), { draftOrder: newOrder });
  };

  const randomizeDraftOrder = async () => {
    if (!isCommissioner) return;
    await saveDraftOrder(shuffleArray(membersSorted.map((m) => m.userId)));
  };

  const moveDraftSlot = async (index, direction) => {
    if (!isCommissioner) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= setupOrder.length) return;
    const next = [...setupOrder];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    await saveDraftOrder(next);
  };

  const startSnakeDraft = async () => {
    if (!isCommissioner || !activePoolCode || membersSorted.length < 2) return;
    const baseOrder = setupOrder.length ? setupOrder : membersSorted.map((m) => m.userId);
    await updateDoc(doc(db, "pools", activePoolCode), {
      draftType: "snake",
      draftStatus: "live",
      currentPickNumber: 1,
      locked: false,
      allowDuplicates: false,
      picksPerUser: PICKS_PER_USER,
      draftOrder: baseOrder,
      pickStartedAtMs: Date.now(),
    });
  };

  const pauseDraft = async () => {
    if (!isCommissioner || !activePoolCode) return;
    await updateDoc(doc(db, "pools", activePoolCode), { draftStatus: "paused" });
  };

  const resumeDraft = async () => {
    if (!isCommissioner || !activePoolCode) return;
    await updateDoc(doc(db, "pools", activePoolCode), { draftStatus: "live", pickStartedAtMs: Date.now() });
  };

  const skipTurn = async () => {
    if (!isCommissioner || !activePoolCode || !currentTurnUserId) return;
    await advanceDraft(currentPickNumber + 1);
  };

  const resetPool = async () => {
    if (!isCommissioner || !activePoolCode) return;
    setBusyReset(true);
    try {
      const picksSnap = await getDocs(query(collection(db, "picks"), where("pool", "==", activePoolCode)));
      await Promise.all(picksSnap.docs.map((pickDoc) => deleteDoc(doc(db, "picks", pickDoc.id))));
      await updateDoc(doc(db, "pools", activePoolCode), {
        locked: false,
        draftStatus: "setup",
        currentPickNumber: 1,
        allowDuplicates: false,
        picksPerUser: PICKS_PER_USER,
        draftOrder: membersSorted.map((m) => m.userId),
        pickStartedAtMs: null,
      });
    } finally {
      setBusyReset(false);
    }
  };

  const copyInviteLink = async () => {
    if (!activePoolCode || typeof window === "undefined") return;
    const url = `${window.location.origin}${window.location.pathname}?pool=${activePoolCode}`;
    await navigator.clipboard.writeText(url);
    setCopiedInvite(true);
    window.setTimeout(() => setCopiedInvite(false), 1500);
  };

  const leaderboard = useMemo(() => {
    const totals = {};
    picksInTournament.forEach((pick) => {
      const score = liveBoard[pick.playerId]?.toPar ?? 0;
      if (!totals[pick.userName]) totals[pick.userName] = { total: 0, picks: [] };
      totals[pick.userName].total += score;
      totals[pick.userName].picks.push({
        golfer: pick.golfer,
        score,
        position: liveBoard[pick.playerId]?.position,
      });
    });
    return Object.entries(totals)
      .map(([userName, value]) => ({ userName, ...value }))
      .sort((a, b) => a.total - b.total || a.userName.localeCompare(b.userName));
  }, [picksInTournament, liveBoard]);

  const myRosterComplete = myPicks.length === picksPerUser;
  const formatScore = (value) => (value === 0 ? "E" : value > 0 ? `+${value}` : `${value}`);

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-6xl mx-auto p-4 md:p-6 grid gap-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Private Golf Pool Snake Draft</h1>
            <p className="text-sm text-slate-600">3 golfers per player, unique golfers, commissioner-controlled snake draft, then automatic scoring.</p>
          </div>
          <div className="flex gap-2 items-center">
            {user ? (
              <>
                <div className="text-sm">{user.displayName || user.email}</div>
                <button onClick={signOutUser} className={buttonBase()}>Sign Out</button>
              </>
            ) : (
              <button onClick={signIn} className={buttonBase()}>Sign In with Google</button>
            )}
          </div>
        </div>

        <div className={cardStyle()}>
          <div className="p-4 grid gap-3 md:grid-cols-[auto_1fr_auto]">
            <button onClick={createPool} disabled={!user} className={buttonBase()}>Create Pool</button>
            <input className="border rounded-2xl p-2 w-full" placeholder="Enter Pool Code" value={poolCodeInput} onChange={(e) => setPoolCodeInput(e.target.value.toUpperCase())} />
            <button onClick={joinPool} className={buttonBase()} disabled={!user}>Join Pool</button>
          </div>
        </div>

        {activePoolCode && (
          <div className={cardStyle()}>
            <div className="p-4 flex flex-col md:flex-row md:justify-between gap-3">
              <div>
                <div className="text-sm text-slate-500">Active Pool</div>
                <div className="text-xl font-semibold tracking-wide">{activePoolCode}</div>
                <div className="text-sm text-slate-500">Commissioner: {poolSettings?.commissionerName || "—"}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={locked ? "text-red-600 font-semibold" : "text-green-700 font-semibold"}>
                  {draftStatus === "setup" ? "Setup" : draftStatus === "paused" ? "Paused" : draftStatus === "finished" ? "Finished" : "Live Draft"}
                </span>
                <button onClick={copyInviteLink} disabled={!activePoolCode} className={buttonBase("outline")}>
                  {copiedInvite ? "Invite Copied" : "Copy Invite Link"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className={cardStyle()}>
            <div className="p-4 grid gap-3">
              <div className="text-lg font-semibold">Draft Board</div>

              <label className="text-sm font-medium">Tournament</label>
              <select
                className="border rounded-2xl p-2"
                value={selectedTournamentId}
                onChange={(e) => {
                  setSelectedTournamentId(e.target.value);
                  if (isCommissioner) updateSetting("tournamentId", e.target.value);
                }}
                disabled={!activePoolCode || draftStatus === "live" || draftStatus === "paused"}
              >
                <option value="">Select tournament</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                ))}
              </select>

              <div className="border rounded-2xl p-3 bg-slate-50">
                <div className="text-sm text-slate-500">Current Turn</div>
                <div className="font-semibold">{currentTurnMember?.userName || "—"}</div>
                <div className="text-sm text-slate-500">Pick {Math.min(currentPickNumber, totalDraftPicks || 1)} of {totalDraftPicks}</div>
                <div className="text-sm font-medium mt-1">Timer: {pickCountdown}s</div>
                <div className="text-sm text-slate-500 mt-1">On deck: {draftOrder[currentPickNumber] ? (membersSorted.find((m) => m.userId === draftOrder[currentPickNumber])?.userName || "—") : "—"}</div>
              </div>

              <label className="text-sm font-medium">Available Golfer</label>
              <select
                className="border rounded-2xl p-2"
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
               disabled={
  !user ||
  !activePoolCode ||
  loadingField ||
  !fieldPlayers.length ||
  myRosterComplete ||
  (draftStatus === "live" && currentTurnUserId !== user?.uid)
}
              >
                <option value="">{loadingField ? "Loading field..." : "Select golfer"}</option>
                {fieldPlayers.map((player) => (
                  <option key={player.id} value={player.id} disabled={takenPlayerIds.has(player.id)}>
                    {player.name}{takenPlayerIds.has(player.id) ? " — drafted" : ""}
                  </option>
                ))}
              </select>

              <div className="flex items-center justify-between text-sm">
                <span>Your roster: {myPicks.length}/{picksPerUser}</span>
                <span>{currentTurnUserId === user?.uid && draftStatus === "live" ? "You are on the clock" : "Waiting"}</span>
              </div>

              <button onClick={makeDraftPick} disabled={!canDraft} className={buttonBase()}>
                Draft Golfer
              </button>

              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
          </div>

          <div className={cardStyle()}>
            <div className="p-4 grid gap-3">
              <div className="text-lg font-semibold">Commissioner Controls</div>

              <div className="text-sm">Draft type: <span className="font-semibold">Snake</span></div>
              <div className="text-sm">Golfers per player: <span className="font-semibold">3</span></div>
              <div className="text-sm">Duplicate golfers: <span className="font-semibold">Not allowed</span></div>

              <label className="text-sm font-medium">Seconds per pick</label>
              <input
                type="number"
                min="10"
                max="300"
                className="border rounded-2xl p-2"
                value={pickSeconds}
                disabled={!isCommissioner || draftStatus === "live"}
                onChange={(e) => updateSetting("pickSeconds", Number(e.target.value) || DEFAULT_PICK_SECONDS)}
              />

              <div className="flex flex-wrap gap-2">
                <button onClick={startSnakeDraft} disabled={!isCommissioner || !selectedTournamentId || membersSorted.length < 2 || draftStatus === "live"} className={buttonBase()}>
                  Start Draft
                </button>
                <button onClick={pauseDraft} disabled={!isCommissioner || draftStatus !== "live"} className={buttonBase("outline")}>
                  Pause
                </button>
                <button onClick={resumeDraft} disabled={!isCommissioner || draftStatus !== "paused"} className={buttonBase("outline")}>
                  Resume
                </button>
                <button onClick={skipTurn} disabled={!isCommissioner || !currentTurnUserId || draftStatus !== "live"} className={buttonBase("outline")}>
                  Skip Turn
                </button>
                <button onClick={randomizeDraftOrder} disabled={!isCommissioner || draftStatus === "live"} className={buttonBase("outline")}>
                  Randomize Order
                </button>
                <button onClick={resetPool} disabled={!isCommissioner || busyReset} className={buttonBase("outline")}>
                  {busyReset ? "Resetting..." : "Reset Draft"}
                </button>
              </div>

              <div className="text-xs text-slate-500">
                {isCommissioner ? (savingSettings ? "Saving settings..." : "The commissioner controls draft order, timer, and flow.") : "Only the commissioner can control the draft."}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={cardStyle()}>
            <div className="p-4">
              <div className="text-lg font-semibold mb-3">Draft Order Setup</div>
              <div className="grid gap-2">
                {setupOrder.length === 0 ? (
                  <div className="text-sm text-slate-500">Add members to generate the snake order.</div>
                ) : (
                  setupOrder.map((userId, index) => {
                    const member = membersSorted.find((m) => m.userId === userId);
                    return (
                      <div key={`${userId}-${index}`} className="flex items-center justify-between border rounded-2xl p-3 gap-3">
                        <div>
                          <div className="font-medium">Slot {index + 1}</div>
                          <div className="text-sm">{member?.userName || "Unknown"}</div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => moveDraftSlot(index, -1)} disabled={!isCommissioner || draftStatus === "live" || index === 0} className={buttonBase("outline")}>↑</button>
                          <button onClick={() => moveDraftSlot(index, 1)} disabled={!isCommissioner || draftStatus === "live" || index === setupOrder.length - 1} className={buttonBase("outline")}>↓</button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className={cardStyle()}>
            <div className="p-4">
              <div className="text-lg font-semibold mb-3">Live Draft Order</div>
              <div className="grid gap-2 max-h-[28rem] overflow-auto pr-1">
                {draftOrder.length === 0 ? (
                  <div className="text-sm text-slate-500">No draft order yet.</div>
                ) : (
                  draftOrder.map((userId, index) => {
                    const member = membersSorted.find((m) => m.userId === userId);
                    const roundNumber = setupOrder.length ? Math.floor(index / setupOrder.length) + 1 : 1;
                    return (
                      <div key={`${userId}-${index}`} className={`flex items-center justify-between border rounded-2xl p-3 ${index + 1 === currentPickNumber && draftStatus === "live" ? "bg-green-50" : ""}`}>
                        <div>
                          <div className="font-medium">Pick {index + 1}</div>
                          <div className="text-xs text-slate-500">Round {roundNumber}</div>
                        </div>
                        <div>{member?.userName || "Unknown"}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={cardStyle()}>
            <div className="p-4">
              <div className="text-xl font-semibold mb-3">Pool Members</div>
              <div className="grid gap-2">
                {membersSorted.length === 0 ? (
                  <div className="text-sm text-slate-500">No members yet.</div>
                ) : (
                  membersSorted.map((member) => {
                    const rosterCount = picksInTournament.filter((p) => p.userId === member.userId).length;
                    return (
                      <div key={member.id} className="border rounded-2xl p-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{member.userName}</div>
                          <div className="text-xs text-slate-500">Roster {rosterCount}/{picksPerUser}</div>
                        </div>
                        <span className={member.role === "commissioner" ? "text-green-700 font-semibold" : "text-slate-500 text-sm"}>
                          {member.role === "commissioner" ? "Commissioner" : "Member"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className={cardStyle()}>
            <div className="p-4">
              <div className="text-lg font-semibold mb-3">Your Roster</div>
              <div className="grid gap-2">
                {myPicks.length === 0 ? (
                  <div className="text-sm text-slate-500">No golfers drafted yet.</div>
                ) : (
                  myPicks
                    .slice()
                    .sort((a, b) => (a.draftPickNumber || 0) - (b.draftPickNumber || 0))
                    .map((pick) => (
                      <div key={pick.id} className="flex items-center justify-between border rounded-2xl p-3 gap-3">
                        <div>
                          <div>{pick.golfer}</div>
                          <div className="text-xs text-slate-500">Draft pick #{pick.draftPickNumber || "—"}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={(liveBoard[pick.playerId]?.toPar ?? 0) < 0 ? "text-green-600" : (liveBoard[pick.playerId]?.toPar ?? 0) > 0 ? "text-red-600" : ""}>
                            {formatScore(liveBoard[pick.playerId]?.toPar ?? 0)}
                          </span>
                          <button onClick={() => removePick(pick.id)} disabled={!isCommissioner && draftStatus === "finished"} className={buttonBase("outline")}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={cardStyle()}>
          <div className="p-4">
            <div className="text-xl font-semibold mb-3">Leaderboard</div>
            <div className="text-sm text-slate-500 mb-3">
              {tournaments.find((t) => t.id === selectedTournamentId)?.name || "No tournament selected"}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Pos</th>
                    <th className="text-left py-2">User</th>
                    <th className="text-left py-2">Roster</th>
                    <th className="text-left py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, index) => (
                    <tr key={entry.userName} className={`border-b ${index === 0 ? "bg-green-50" : ""}`}>
                      <td className="py-2">{index + 1}</td>
                      <td className="py-2 font-medium">{entry.userName}</td>
                      <td className="py-2">
                        <div className="grid gap-1">
                          {entry.picks.map((pick, pickIndex) => (
                            <div key={`${pick.golfer}-${pickIndex}`} className="flex items-center justify-between gap-3 rounded-xl border px-2 py-1 text-xs md:text-sm">
                              <div>
                                <div>{pick.golfer}</div>
                                <div className="text-xs text-slate-500">{pick.position ? `Pos ${pick.position}` : "Live"}</div>
                              </div>
                              <span className={pick.score < 0 ? "text-green-600 font-medium" : pick.score > 0 ? "text-red-600 font-medium" : "font-medium"}>
                                {formatScore(pick.score)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className={`py-2 font-semibold ${entry.total < 0 ? "text-green-600" : entry.total > 0 ? "text-red-600" : ""}`}>
                        {formatScore(entry.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className={cardStyle()}>
          <div className="p-4">
            <div className="text-lg font-semibold mb-3">Recommended Firestore Security Rules</div>
            <pre className="whitespace-pre-wrap text-xs md:text-sm bg-slate-50 border rounded-2xl p-3 overflow-x-auto">{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }

    function isCommissioner(poolId) {
      return isSignedIn() &&
        get(/databases/$(database)/documents/pools/$(poolId)).data.commissionerId == request.auth.uid;
    }

    match /pools/{poolId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.resource.data.commissionerId == request.auth.uid;
      allow update: if isCommissioner(poolId);
      allow delete: if isCommissioner(poolId);

      match /members/{memberId} {
        allow read: if isSignedIn();
        allow create, update: if isSignedIn() && request.auth.uid == memberId;
        allow delete: if isCommissioner(poolId) || (isSignedIn() && request.auth.uid == memberId);
      }
    }

    match /picks/{pickId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && request.resource.data.userId == request.auth.uid
        && exists(/databases/$(database)/documents/pools/$(request.resource.data.pool));
      allow update, delete: if isCommissioner(resource.data.pool) || (isSignedIn() && resource.data.userId == request.auth.uid);
    }
  }
}`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
