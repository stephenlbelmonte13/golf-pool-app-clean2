import { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const API_KEY = import.meta.env.VITE_PGA_API_KEY;
const API_BASE = "https://api.balldontlie.io/pga/v1";

export default function LivePgaLeaderboardTracker() {
  const [user, setUser] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [liveBoard, setLiveBoard] = useState({});
  const [loadingTournaments, setLoadingTournaments] = useState(false);
  const [loadingScores, setLoadingScores] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => setUser(nextUser));
    return () => unsub();
  }, []);

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
          const priority = list.find((t) => t.status === "In Progress") || list[0];
          setSelectedTournamentId(priority.id);
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

    const fetchLiveLeaderboard = async () => {
      try {
        setLoadingScores(true);
        setError("");
        const data = await apiFetch(`/tournament_results?tournament_ids[]=${selectedTournamentId}&per_page=100`);

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
          };
        });

        setLiveBoard(board);
        setLastUpdated(new Date());
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

  const signIn = async () => signInWithPopup(auth, provider);
  const signOutUser = async () => signOut(auth);

  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === selectedTournamentId) || null,
    [tournaments, selectedTournamentId]
  );

  const leaderboardRows = useMemo(() => {
    return Object.values(liveBoard)
      .filter((row) => row.playerName.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        const aPos = typeof a.positionNumeric === "number" ? a.positionNumeric : Number.MAX_SAFE_INTEGER;
        const bPos = typeof b.positionNumeric === "number" ? b.positionNumeric : Number.MAX_SAFE_INTEGER;
        return aPos - bPos || a.playerName.localeCompare(b.playerName);
      });
  }, [liveBoard, search]);

  const formatScore = (value) => {
    if (value === 0) return "E";
    return value > 0 ? `+${value}` : `${value}`;
  };

  const formatUpdated = (value) => {
    if (!value) return "—";
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  };

  const panelClass = "rounded-2xl shadow-sm border bg-white";
  const buttonClass = "rounded-2xl px-4 py-2 bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 grid gap-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Live PGA Leaderboard Tracker</h1>
          <p className="text-sm text-slate-500">Simple live tournament scoring board with search and auto-refresh.</p>
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
        <div className="p-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Tournament</label>
            <select
              className="border rounded-2xl p-2"
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              disabled={loadingTournaments}
            >
              <option value="">{loadingTournaments ? "Loading tournaments..." : "Select tournament"}</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Search golfer</label>
            <input
              className="border rounded-2xl p-2"
              placeholder="Search by player name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-col justify-end text-sm">
            <div className="text-slate-500">Last updated</div>
            <div className="font-medium">{formatUpdated(lastUpdated)}</div>
          </div>
        </div>
      </div>

      {selectedTournament && (
        <div className={panelClass}>
          <div className="p-4 grid gap-1 md:grid-cols-2">
            <div>
              <div className="text-sm text-slate-500">Tournament</div>
              <div className="text-lg font-semibold">{selectedTournament.name}</div>
              <div className="text-sm text-slate-500">{selectedTournament.status}</div>
            </div>
            <div className="md:text-right">
              <div className="text-sm text-slate-500">Dates</div>
              <div className="text-sm">
                {selectedTournament.startDate || "—"} {selectedTournament.endDate ? `to ${selectedTournament.endDate}` : ""}
              </div>
              <div className="text-sm text-slate-500">{selectedTournament.venue || ""}</div>
            </div>
          </div>
        </div>
      )}

      <div className={panelClass}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xl font-semibold">Leaderboard</div>
            <div className="text-sm text-slate-500">
              {loadingScores ? "Refreshing..." : `${leaderboardRows.length} golfers`}
            </div>
          </div>

          {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Pos</th>
                  <th className="text-left py-2">Player</th>
                  <th className="text-left py-2">Country</th>
                  <th className="text-left py-2">To Par</th>
                  <th className="text-left py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row, index) => (
                  <tr key={row.playerId} className={`border-b ${index === 0 ? "bg-green-50" : ""}`}>
                    <td className="py-2">{row.position || "—"}</td>
                    <td className="py-2 font-medium">{row.playerName}</td>
                    <td className="py-2">{row.country || "—"}</td>
                    <td
                      className={`py-2 ${
                        row.toPar < 0
                          ? "text-green-600 font-semibold"
                          : row.toPar > 0
                          ? "text-red-600 font-semibold"
                          : "font-semibold"
                      }`}
                    >
                      {formatScore(row.toPar)}
                    </td>
                    <td className="py-2">{Number.isFinite(row.totalScore) ? row.totalScore : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
