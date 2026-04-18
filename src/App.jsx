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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => setUser(nextUser));
    return () => unsub();
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
    } else if (savedPool && !activePoolCode) {
      setPoolCodeInput(savedPool);
      setActivePoolCode(savedPool);
    }

    if (savedTournament && !selectedTournamentId) {
      setSelectedTournamentId(savedTournament);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activePoolCode) {
      window.localStorage.setItem("pga_pool_code", activePoolCode);
    }
  }, [activePoolCode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedTournamentId) {
      window.localStorage.setItem("pga_tournament_id", selectedTournamentId);
    }
  }, [selectedTournamentId]);

  const apiFetch = async (path) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: API_KEY },
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  };

  const panelClass = "rounded-2xl border bg-white shadow-sm";
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
          const savedTournament = typeof window !== "undefined" ? window.localStorage.getItem("pga_tournament_id") : "";
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
        if (data.tournamentId) {
          setSelectedTournamentId(data.tournamentId);
        }
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

  const createPool = async () => {
    if (!user) return;
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    await setDoc(doc(db, "pools", code), {
      code,
      commissionerId: user.uid,
      commissionerName: user.displayName || user.email,
      picksPerUser: PICKS_PER_USER,
      tournamentId: selectedTournamentId || "",
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
    if (!user || !activePoolCode || !selectedTournamentId || !selectedPlayer) return;
    if (myPicks.length >= PICKS_PER_USER) return;
    if (takenPlayerIds.has(selectedPlayer.id)) return;

    await addDoc(collection(db, "picks"), {
      pool: activePoolCode,
      tournamentId: selectedTournamentId,
      userId: user.uid,
      userName: user.displayName || user.email,
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

  const formatScore = (value) => {
    if (value === 0) return "E";
    return value > 0 ? `+${value}` : `${value}`;
  };

  const formatUpdated = (value) => {
    if (!value) return "—";
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  };

  const hasPoolContext = Boolean(activePoolCode);
  const hasDraftedPlayers = draftedLiveRows.length > 0;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 grid gap-4 bg-slate-100 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Shared PGA Pool Tracker</h1>
          <p className="text-sm text-slate-500">Create a pool, share it with friends, pick golfers, and track live scores on your phones.</p>
        </div>
        <div className="flex gap-2 items-center">
          {user ? (
            <>
              <div className="text-sm">{user.displayName || user.email}</div>
              <button onClick={signOutUser} className={buttonClass}>Sign Out</button>
            </>
          ) : (
            <button onClick={signIn} className={buttonClass}>Sign In with Google</button>
          )}
        </div>
      </div>

      <div className={panelClass}>
        <div className="p-4 grid gap-3 lg:grid-cols-[auto_1fr_auto_auto]">
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
            <div className="text-lg font-semibold">Tournament</div>
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

            {selectedTournament && (
              <div className="text-sm text-slate-600">
                <div className="font-medium">{selectedTournament.name}</div>
                <div>{selectedTournament.status}</div>
                <div>{selectedTournament.startDate || "—"} {selectedTournament.endDate ? `to ${selectedTournament.endDate}` : ""}</div>
                <div>{selectedTournament.venue || ""}</div>
              </div>
            )}
          </div>
        </div>

        <div className={panelClass}>
          <div className="p-4 grid gap-3">
            <div className="text-lg font-semibold">Pick Golfers</div>
            <div className="text-sm text-slate-500">Your picks: {myPicks.length}/{PICKS_PER_USER}</div>
            <select
              className="border rounded-2xl p-2"
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              disabled={!user || !activePoolCode || loadingField || !fieldPlayers.length || myPicks.length >= PICKS_PER_USER}
            >
              <option value="">{loadingField ? "Loading tournament field..." : "Select golfer"}</option>
              {fieldPlayers.map((player) => (
                <option key={player.id} value={player.id} disabled={takenPlayerIds.has(player.id)}>
                  {player.name}{takenPlayerIds.has(player.id) ? " — taken" : ""}
                </option>
              ))}
            </select>
            <button onClick={addPick} disabled={!user || !activePoolCode || !selectedPlayerId || myPicks.length >= PICKS_PER_USER} className={buttonClass}>
              Add Pick
            </button>
          </div>
        </div>
      </div>

      <div className={panelClass}>
        <div className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">App opens back to your saved pool and tournament.</div>
            <div className="text-sm font-medium">Current view: {viewMode === "pool" ? "Your drafted golfers" : "Full tournament board"}</div>
          </div>
          <div className="flex gap-2">
            <button className={viewMode === "pool" ? buttonClass : outlineButtonClass} onClick={() => setViewMode("pool")}>
              My Pool Scores
            </button>
            <button className={viewMode === "all" ? buttonClass : outlineButtonClass} onClick={() => setViewMode("all")}>
              Full Leaderboard
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className={panelClass}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
             <div className="text-2xl md:text-3xl font-semibold tracking-tight text-stone-900"> {viewMode === "pool" ? "Your Drafted Golfers Live Scores" : "Live Leaderboard"}</div>
              <div className="text-sm text-slate-500">{loadingScores ? "Refreshing..." : `Updated ${formatUpdated(lastUpdated)}`}</div>
            </div>

            <div className="mb-3">
              <input
                className="border rounded-2xl p-2 w-full"
                placeholder={viewMode === "pool" ? "Search drafted golfer or owner" : "Search golfer"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
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
                      </tr>
                    </thead>
                    <tbody>
                      {draftedLiveRows
                        .filter((row) => {
                          const q = search.trim().toLowerCase();
                          if (!q) return true;
                          return row.golfer.toLowerCase().includes(q) || row.userName.toLowerCase().includes(q);
                        })
                        .map((row) => (
                          <tr key={row.id} className="border-b">
                            <td className="py-2 font-medium">{row.userName}</td>
                            <td className="py-2">{row.golfer}</td>
                            <td className="py-2">{row.position}</td>
                            <td className={`py-3 text-xl md:text-2xl tabular-nums ${row.toPar < 0 ? "text-green-700 font-bold" : row.toPar > 0 ? "text-red-700 font-bold" : "font-bold text-stone-700"}`}>
  {formatScore(row.toPar)}
</td>
                            <td className="py-2">{Number.isFinite(row.totalScore) ? row.totalScore : "—"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-slate-500">Once your group drafts golfers, this screen will reopen directly to their live scores.</div>
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
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardRows.map((row, index) => (
                      <tr
                        key={row.playerId}
                        className={`border-b cursor-pointer ${index === 0 ? "bg-green-50" : ""} ${selectedBoardPlayerId === row.playerId ? "bg-slate-100" : ""}`}
                        onClick={() => setSelectedBoardPlayerId(row.playerId)}
                      >
                        <td className="py-2">{row.position || "—"}</td>
                        <td className="py-2 font-medium">{row.playerName}</td>
                        <td className="py-2">{row.country || "—"}</td>
                        <td className={`py-2 ${row.toPar < 0 ? "text-green-600 font-semibold" : row.toPar > 0 ? "text-red-600 font-semibold" : "font-semibold"}`}>
                          {formatScore(row.toPar)}
                        </td>
                        <td className="py-2">{Number.isFinite(row.totalScore) ? row.totalScore : "—"}</td>
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
              <div className="text-lg font-semibold mb-3">Pool Leaderboard</div>
              {hasPoolContext && hasDraftedPlayers && <div className="text-xs text-slate-500 mb-2">This is the screen your group will care about most after drafting.</div>}
              <div className="grid gap-2">
                {poolLeaderboard.length === 0 ? (
                  <div className="text-sm text-slate-500">No picks yet.</div>
                ) : (
                  poolLeaderboard.map((entry, index) => (
                    <div key={entry.userName} className={`border rounded-2xl p-3 ${index === 0 ? "bg-green-50" : ""}`}>
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{entry.userName}</div>
                        <div className={entry.total < 0 ? "text-green-600 font-semibold" : entry.total > 0 ? "text-red-600 font-semibold" : "font-semibold"}>
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
                  ))
                )}
              </div>
            </div>
          </div>

          <div className={panelClass}>
            <div className="p-4">
              <div className="text-lg font-semibold mb-3">Selected Golfer Details</div>
              <div className="text-xs text-slate-500 mb-2">Tap any golfer in the full leaderboard to inspect all available live result fields from your BallDontLie account.</div>
              {selectedBoardPlayer ? (
                <div className="grid gap-2 text-sm">
                  <div><span className="font-medium">Player:</span> {selectedBoardPlayer.playerName}</div>
                  <div><span className="font-medium">Position:</span> {selectedBoardPlayer.position || "—"}</div>
                  <div><span className="font-medium">To Par:</span> {formatScore(selectedBoardPlayer.toPar)}</div>
                  <div><span className="font-medium">Total Score:</span> {selectedBoardPlayer.totalScore}</div>
                  <div><span className="font-medium">Country:</span> {selectedBoardPlayer.country || "—"}</div>
                  <div><span className="font-medium">Earnings:</span> {selectedBoardPlayer.earnings ?? "—"}</div>
                  <pre className="mt-2 whitespace-pre-wrap text-xs bg-slate-50 border rounded-2xl p-3 overflow-x-auto">{JSON.stringify(selectedBoardPlayer.raw, null, 2)}</pre>
                </div>
              ) : (
                <div className="text-sm text-slate-500">Select a golfer from the leaderboard.</div>
              )}
            </div>
          </div>

          <div className={panelClass}>
            <div className="p-4">
              <div className="text-lg font-semibold mb-3">Pool Members</div>
              <div className="grid gap-2">
                {members.length === 0 ? (
                  <div className="text-sm text-slate-500">No members yet.</div>
                ) : (
                  members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between border rounded-2xl p-3">
                      <div>
                        <div className="font-medium">{member.userName}</div>
                        <div className="text-xs text-slate-500">{member.email || member.userId}</div>
                      </div>
                      <div className="text-sm text-slate-500">{member.role}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
